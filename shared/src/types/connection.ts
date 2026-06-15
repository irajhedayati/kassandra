/**
 * Connection profiles. Persisted at ~/.kassandra/config.json
 * (KASSANDRA_HOME env var overrides the directory).
 *
 * Mirrors the legacy Python ConnectionProfile shape — see
 * legacy/src/config/settings.py.
 */

export type SslProtocol =
  | 'PROTOCOL_TLS'
  | 'PROTOCOL_TLS_CLIENT'
  | 'PROTOCOL_TLS_SERVER'
  | 'PROTOCOL_TLSv1'
  | 'PROTOCOL_TLSv1_1'
  | 'PROTOCOL_TLSv1_2'
  | 'PROTOCOL_SSLv23';

export type ConsistencyLevel =
  | 'ANY'
  | 'ONE'
  | 'TWO'
  | 'THREE'
  | 'QUORUM'
  | 'ALL'
  | 'LOCAL_QUORUM'
  | 'EACH_QUORUM'
  | 'SERIAL'
  | 'LOCAL_SERIAL'
  | 'LOCAL_ONE';

export interface ConnectionProfile {
  name: string;
  hosts: string[];
  port: number;
  username: string;
  password: string;
  ssl_enabled: boolean;
  ssl_protocol: SslProtocol;
  ssl_cert_path: string;
  default_keyspace: string;
  consistency_level: ConsistencyLevel;
  connection_timeout: number;
  protocol_version: number;
}

export type TableMetadata = Record<string, Record<string, ColumnMetadata>>;

export interface ColumnMetadata {
  hide?: boolean;
  display_type?: string;
  map_schema?: MapSchemaEntry[];
}

export interface MapSchemaEntry {
  key: string;
  label: string;
}

export interface AppSettings {
  connections: ConnectionProfile[];
  last_connection_name: string;
  table_metadata: TableMetadata;
}

export interface ConnectionStatus {
  connected: boolean;
  profileName: string | null;
  keyspace: string | null;
}

export const DEFAULT_PROFILE: ConnectionProfile = {
  name: '',
  hosts: ['127.0.0.1'],
  port: 9042,
  username: '',
  password: '',
  ssl_enabled: false,
  ssl_protocol: 'PROTOCOL_TLS',
  ssl_cert_path: '',
  default_keyspace: '',
  consistency_level: 'LOCAL_ONE',
  connection_timeout: 5,
  // v4 is the highest version the Node cassandra-driver accepts as an
  // explicit maxVersion. v5/v6 constants exist but the driver rejects them
  // during option validation.
  protocol_version: 4,
};
