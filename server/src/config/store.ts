/**
 * Persistence for AppSettings (connection profiles + per-column metadata).
 *
 * Stored at:
 *   {PY_SANDRA_HOME ?? ~/.py-sandra}/config.json
 *
 * Implemented by the connection lane (used by both connection and metadata
 * routers); mirrors legacy/src/config/settings.py (ConfigManager).
 *
 * Required exports:
 *   loadSettings():        AppSettings        (creates file with defaults if missing)
 *   saveSettings(s):       void
 *   listProfiles():        ConnectionProfile[]
 *   getProfile(name):      ConnectionProfile | null
 *   upsertProfile(p):      ConnectionProfile
 *   deleteProfile(name):   void
 *   getColumnMetadata(ks, t, col):    ColumnMetadata
 *   setColumnMetadata(ks, t, col, m): ColumnMetadata
 *   getTableMetadata(ks, t):          Record<string, ColumnMetadata>
 */

export {};
