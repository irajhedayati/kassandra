/**
 * Cassandra connection lifecycle. Mirrors legacy/src/database/connection.py.
 *
 * Builds a `cassandra-driver` Client from a ConnectionProfile, applies SSL
 * and auth, configures a default ExecutionProfile with the chosen
 * consistency level, and on success registers the active session via
 * cassandra/state.ts.
 */
import fs from 'node:fs';
import {
  Client,
  ExecutionProfile,
  auth,
  policies,
  types as driverTypes,
} from 'cassandra-driver';
import type { ClientOptions } from 'cassandra-driver';
import type { ConnectionProfile, ConnectionStatus } from '@kassandra/shared';
import { clearActive, getActive, setActive } from './state.js';

interface SecureContextOptions {
  rejectUnauthorized: boolean;
  ca?: Buffer;
  // Match legacy Python `ssl_context.check_hostname = False`: validate
  // the cert chain (when a CA is provided), but skip hostname/IP SAN
  // matching so users can connect through tunnels, NAT, or any IP that
  // doesn't appear in the cert's SAN list.
  checkServerIdentity?: () => undefined;
}

function buildSslOptions(profile: ConnectionProfile): SecureContextOptions | undefined {
  if (!profile.ssl_enabled) return undefined;
  const opts: SecureContextOptions = {
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
  };
  if (profile.ssl_cert_path && profile.ssl_cert_path.trim() !== '') {
    opts.ca = fs.readFileSync(profile.ssl_cert_path);
    opts.rejectUnauthorized = true;
  }
  return opts;
}

function consistencyForProfile(profile: ConnectionProfile): number {
  // cassandra-driver exposes consistency level constants on
  // `types.consistencies` keyed by lower-case name (e.g. localOne, one,
  // quorum, localQuorum). Map our literal to the camelCase key.
  const map: Record<string, keyof typeof driverTypes.consistencies> = {
    ANY: 'any',
    ONE: 'one',
    TWO: 'two',
    THREE: 'three',
    QUORUM: 'quorum',
    ALL: 'all',
    LOCAL_QUORUM: 'localQuorum',
    EACH_QUORUM: 'eachQuorum',
    SERIAL: 'serial',
    LOCAL_SERIAL: 'localSerial',
    LOCAL_ONE: 'localOne',
  };
  const key = map[profile.consistency_level] ?? 'localOne';
  return driverTypes.consistencies[key];
}

/**
 * Whether the driver will accept this number as a `protocolOptions.maxVersion`.
 * cassandra-driver defines version constants up to 6 and DSE 1/2, but its
 * internal `protocolVersion.isSupported` check (used during option
 * validation) rejects v5 and v6. Callers should omit `maxVersion` when this
 * returns false so the driver auto-negotiates.
 */
function isSupportedProtocolVersion(v: number): boolean {
  const pv = driverTypes.protocolVersion as unknown as {
    isSupported?: (v: number) => boolean;
  };
  if (typeof pv.isSupported === 'function') return pv.isSupported(v);
  // Fallback for older driver builds: accept v1–v4 + DSE v1/v2.
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 65 || v === 66;
}

function buildClientOptions(profile: ConnectionProfile): ClientOptions {
  const consistency = consistencyForProfile(profile);
  const defaultProfile = new ExecutionProfile('default', {
    consistency,
    loadBalancing: new policies.loadBalancing.RoundRobinPolicy(),
  });

  const options: ClientOptions = {
    contactPoints: profile.hosts,
    protocolOptions: {
      port: profile.port,
      // Only pass maxVersion if the driver recognizes it as supported.
      // cassandra-driver defines constants for v5/v6 but its internal
      // isSupported() check rejects them as a configured maxVersion,
      // throwing "protocolOptions.maxVersion provided (N) is invalid".
      // Without maxVersion the driver auto-negotiates.
      ...(isSupportedProtocolVersion(profile.protocol_version)
        ? { maxVersion: profile.protocol_version }
        : {}),
    },
    socketOptions: {
      // legacy `connect_timeout` is in seconds; driver expects ms.
      connectTimeout: Math.max(1, profile.connection_timeout) * 1000,
    },
    profiles: [defaultProfile],
    // Use plain RoundRobin over the supplied contact points; matches
    // legacy WhiteListRoundRobinPolicy semantics for our small test
    // clusters and avoids the localDataCenter requirement of the
    // default DC-aware policy in cassandra-driver 4.x.
    policies: {
      loadBalancing: new policies.loadBalancing.RoundRobinPolicy(),
    },
  };

  if (profile.username && profile.password) {
    options.authProvider = new auth.PlainTextAuthProvider(
      profile.username,
      profile.password,
    );
  }

  const ssl = buildSslOptions(profile);
  if (ssl) {
    options.sslOptions = ssl;
  }

  return options;
}

export interface ConnectResult {
  ok: boolean;
  message: string;
  status: ConnectionStatus;
}

/**
 * Disconnect the currently active client (if any), then connect using the
 * given profile. On success, register the new session via setActive().
 */
export async function connect(profile: ConnectionProfile): Promise<ConnectResult> {
  await disconnect();

  const client = new Client(buildClientOptions(profile));
  try {
    await client.connect();
  } catch (err) {
    // Clean up any partially-initialized client state so a retry works.
    try {
      await client.shutdown();
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Connection failed: ${message}`,
      status: { connected: false, profileName: null, keyspace: null },
    };
  }

  let keyspace: string | null = null;
  if (profile.default_keyspace && profile.default_keyspace.trim() !== '') {
    try {
      // Quoted to preserve case-sensitive keyspace names.
      await client.execute(`USE "${profile.default_keyspace.replace(/"/g, '""')}"`);
      keyspace = profile.default_keyspace;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await client.shutdown();
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        message: `Connected, but failed to USE keyspace "${profile.default_keyspace}": ${message}`,
        status: { connected: false, profileName: null, keyspace: null },
      };
    }
  }

  setActive({ client, profile, keyspace });

  return {
    ok: true,
    message: `Connected to ${profile.hosts.join(', ')}`,
    status: { connected: true, profileName: profile.name, keyspace },
  };
}

export async function disconnect(): Promise<ConnectionStatus> {
  const active = getActive();
  if (!active) {
    return { connected: false, profileName: null, keyspace: null };
  }
  try {
    await active.client.shutdown();
  } catch (err) {
    console.warn('[kassandra] error during shutdown:', err);
  }
  clearActive();
  return { connected: false, profileName: null, keyspace: null };
}

export function status(): ConnectionStatus {
  const active = getActive();
  if (!active) return { connected: false, profileName: null, keyspace: null };
  return {
    connected: true,
    profileName: active.profile.name,
    keyspace: active.keyspace,
  };
}
