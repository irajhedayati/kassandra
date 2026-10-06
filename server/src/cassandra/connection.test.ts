import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '@kassandra/shared';
import { buildClientOptions } from './connection.js';

const profile = {
  name: 'p',
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
  protocol_version: 4,
  local_datacenter: 'dc1',
} as ConnectionProfile;

describe('buildClientOptions', () => {
  // Without encoding.map/set the driver binds ES6 Map/Set values as empty
  // collections, silently dropping map/set data on insert and update.
  it('makes the driver encode ES6 Map and Set values', () => {
    const { encoding } = buildClientOptions(profile);
    expect(encoding?.map).toBe(Map);
    expect(encoding?.set).toBe(Set);
  });
});
