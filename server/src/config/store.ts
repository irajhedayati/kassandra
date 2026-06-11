/**
 * Persistence for AppSettings (connection profiles + per-column metadata).
 *
 * Stored at:
 *   {PY_SANDRA_HOME ?? ~/.py-sandra}/config.json
 *
 * Mirrors legacy/src/config/settings.py (ConfigManager). Uses synchronous
 * fs because the file is tiny and operations are infrequent (request-scoped).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  AppSettings,
  ColumnMetadata,
  ConnectionProfile,
  TableMetadata,
} from '@py-sandra/shared';
import { DEFAULT_PROFILE } from '@py-sandra/shared';

const DEFAULT_DIR_NAME = '.py-sandra';
const CONFIG_FILE_NAME = 'config.json';

function getConfigDir(): string {
  const env = process.env.PY_SANDRA_HOME;
  if (env && env.trim() !== '') return env;
  return path.join(os.homedir(), DEFAULT_DIR_NAME);
}

function getConfigFile(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

function defaultSettings(): AppSettings {
  return {
    connections: [],
    last_connection_name: '',
    table_metadata: {},
  };
}

function ensureConfigDir(): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Coerce a partial profile from disk into a full ConnectionProfile by
 * filling in defaults for any missing fields.
 */
function normalizeProfile(p: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    ...DEFAULT_PROFILE,
    ...p,
    name: p.name ?? '',
    hosts: Array.isArray(p.hosts) && p.hosts.length > 0 ? p.hosts : ['127.0.0.1'],
  };
}

function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const data = raw as Record<string, unknown>;
  const conns = Array.isArray(data.connections) ? data.connections : [];
  const connections: ConnectionProfile[] = conns
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => normalizeProfile(c as Partial<ConnectionProfile>));
  const last =
    typeof data.last_connection_name === 'string' ? data.last_connection_name : '';
  const tableMeta =
    data.table_metadata && typeof data.table_metadata === 'object'
      ? (data.table_metadata as TableMetadata)
      : {};
  return {
    connections,
    last_connection_name: last,
    table_metadata: tableMeta,
  };
}

export function loadSettings(): AppSettings {
  const file = getConfigFile();
  if (!fs.existsSync(file)) {
    const settings = defaultSettings();
    saveSettings(settings);
    return settings;
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSettings(parsed);
  } catch (err) {
    console.warn('[py-sandra] could not parse config file:', err);
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  ensureConfigDir();
  const file = getConfigFile();
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8');
}

export function listProfiles(): ConnectionProfile[] {
  return loadSettings().connections;
}

export function getProfile(name: string): ConnectionProfile | null {
  const settings = loadSettings();
  return settings.connections.find((c) => c.name === name) ?? null;
}

export function upsertProfile(profile: ConnectionProfile): ConnectionProfile {
  const settings = loadSettings();
  const filtered = settings.connections.filter((c) => c.name !== profile.name);
  filtered.push(profile);
  settings.connections = filtered;
  saveSettings(settings);
  return profile;
}

export function deleteProfile(name: string): void {
  const settings = loadSettings();
  settings.connections = settings.connections.filter((c) => c.name !== name);
  if (settings.last_connection_name === name) {
    settings.last_connection_name = '';
  }
  saveSettings(settings);
}

export function setLastConnection(name: string): void {
  const settings = loadSettings();
  settings.last_connection_name = name;
  saveSettings(settings);
}

function tableKey(keyspace: string, table: string): string {
  return `${keyspace}.${table}`;
}

export function getColumnMetadata(
  keyspace: string,
  table: string,
  column: string,
): ColumnMetadata {
  const settings = loadSettings();
  const tableMeta = settings.table_metadata[tableKey(keyspace, table)];
  if (!tableMeta) return {};
  return tableMeta[column] ?? {};
}

export function setColumnMetadata(
  keyspace: string,
  table: string,
  column: string,
  metadata: ColumnMetadata,
): ColumnMetadata {
  const settings = loadSettings();
  const key = tableKey(keyspace, table);
  const tableMeta = settings.table_metadata[key] ?? {};
  const existing = tableMeta[column] ?? {};
  const merged: ColumnMetadata = { ...existing, ...metadata };
  tableMeta[column] = merged;
  settings.table_metadata[key] = tableMeta;
  saveSettings(settings);
  return merged;
}

export function getTableMetadata(
  keyspace: string,
  table: string,
): Record<string, ColumnMetadata> {
  const settings = loadSettings();
  return settings.table_metadata[tableKey(keyspace, table)] ?? {};
}
