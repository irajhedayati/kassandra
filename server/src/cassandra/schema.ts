/**
 * Schema introspection — queries system_schema.keyspaces / .tables / .columns.
 * Implemented by the schema lane; mirrors legacy/src/database/model.py
 * (SchemaInspector class).
 *
 * System keyspaces to filter out:
 *   system, system_auth, system_schema, system_distributed,
 *   system_traces, system_views, system_virtual_schema
 */

export {};
