# JS rewrite — agent contract

This document is the contract for the parallel implementation workflow.
Each lane owns specific files and must NOT touch files outside its
ownership without coordinating. Cross-lane communication happens via
the types in `shared/` and the singleton in `server/src/cassandra/state.ts`.

The legacy Python app under `legacy/src/` is the source of truth for
behavior. Cite `legacy/path/file.py:line` when matching semantics.

## Tech stack (locked)

- Server: Node 20, Express 4, `cassandra-driver` 4.x, Zod for input validation
- Client: React 18, Vite 5, Tailwind 3, TanStack Query 5, TanStack Table 8, Zustand 5, `@monaco-editor/react`
- Shared: TypeScript 5 only (no runtime code in `shared/`)
- Package manager: pnpm 9 with workspaces

## Wire shapes — see `shared/src/`

- `ConnectionProfile`, `AppSettings`, `ConnectionStatus`, `ColumnMetadata` (`types/connection.ts`)
- `TableSchema`, `ColumnInfo`, `KeyspaceList`, `TableList` (`types/schema.ts`)
- `QueryResponse`, `QueryResult`, `QueryError`, `PaginatedReadRequest`, `CqlExecRequest` (`types/query.ts`)
- `ApiResponse<T>`, `ApiOk<T>`, `ApiErr` (`types/api.ts`)
- `CQL_TYPE_INFO`, `getTypeInfo`, `rootCqlType` (`types/cql-types.ts`)

Routes that return a typed payload return `{ ok: true, data: T }`.
Routes that return query rows return `QueryResponse` (envelope tagged
by `success`, NOT `ok`).

## Lane ownership

### Lane A — Connection + config persistence

**Files (server):**
- `server/src/cassandra/connection.ts` — connect/disconnect, SSL, auth.
- `server/src/config/store.ts` — `~/.kassandra/config.json` reader/writer.
- `server/src/routes/connection.ts` — implement all 7 routes.

**Files (client):**
- `client/src/api/connection.ts` (NEW) — typed fetch helpers.
- `client/src/components/Sidebar/ConnectionPanel.tsx` — replace stub.
- `client/src/components/Dialogs/ConnectionForm.tsx` (NEW) — add/edit profile modal.

**Behavior to match:**
- `~/.kassandra/config.json` shape from `legacy/src/config/settings.py`.
  Use `KASSANDRA_HOME` env override.
- SSL options: if `ssl_enabled`, build `tls.SecureContextOptions` with
  `rejectUnauthorized=false` when `ssl_cert_path` is empty, else load CA.
- Apply consistency level via execution profile (cassandra-driver:
  `ExecutionProfile` with `consistency` set from `types.consistencies`).
- On connect, call `setActive(...)` from `cassandra/state.ts`.
- On disconnect, call `clearActive()` AFTER `client.shutdown()`.
- Tolerate connect failures: return `{ ok: false, message }` with status 502.

### Lane B — Schema introspection

**Files (server):**
- `server/src/cassandra/schema.ts` — query helpers.
- `server/src/routes/schema.ts` — implement 3 routes.

**Files (client):**
- `client/src/api/schema.ts` (NEW).
- `client/src/components/Sidebar/SchemaNavigator.tsx` — replace stub.

**Behavior:**
- Filter system keyspaces (`system`, `system_auth`, `system_schema`,
  `system_distributed`, `system_traces`, `system_views`,
  `system_virtual_schema`).
- Sort keyspaces and tables alphabetically.
- For columns, read `kind` (`partition_key|clustering|regular|static`),
  `position`, `clustering_order` (default `'ASC'`).
- Use `requireSession()` from `cassandra/state.ts`.

### Lane C — Data grid + row CRUD

**Files (server):**
- `server/src/cassandra/repository.ts` — INSERT, UPDATE, DELETE, paginated SELECT.
- `server/src/routes/data.ts` — implement 4 routes.

**Files (client):**
- `client/src/api/data.ts` (NEW).
- `client/src/components/DataGrid/DataGrid.tsx` — replace stub. Use
  TanStack Table; render via Tailwind. Page sizes [10, 25, 50].
- `client/src/components/DataGrid/PaginationBar.tsx` (NEW).
- `client/src/components/DataGrid/RowDetail.tsx` (NEW) — drawer/modal on
  row click with Edit and Delete actions.
- `client/src/components/Dialogs/ConfirmDelete.tsx` (NEW).

**Behavior:**
- Pagination: pass `pageSize` to driver as `fetchSize`; pass
  `pagingState` (decoded from base64 to Buffer) for next-page.
- Encode driver's returned `pageState` Buffer as base64 → `pagingState`
  in `QueryResult`. `hasMorePages` from result.
- INSERT: build prepared statement; bind values for non-null/non-empty
  columns. Coerce JS arrays to `Set` for `set<...>` columns.
- UPDATE: SET clause = regular columns only; WHERE clause = ALL primary
  keys (partition + clustering). USE PARAMETER BINDING — the legacy
  Python code uses string interpolation, which is a SQL-injection bug;
  fix it in the rewrite.
- DELETE: WHERE clause = ALL primary keys, parameter-bound.
- Filters: simple equality on text columns only (matches legacy);
  applied as additional `WHERE` clauses.

### Lane D — Dynamic form + CRUD wiring (depends on A, B, C contracts)

**Files (client):**
- `client/src/components/Forms/DynamicForm.tsx` (NEW) — schema-driven
  form generator. Reads `TableSchema`; for each column, picks the field
  via `getTypeInfo(column.cql_type).widget`.
- `client/src/components/Forms/InsertForm.tsx` — replace stub; uses
  DynamicForm for insert mode.
- `client/src/components/Forms/UpdateForm.tsx` (NEW) — used by row
  detail; primary keys disabled.
- `client/src/components/Forms/fields/` — one component per widget kind:
  `TextField`, `NumberField`, `CheckboxField`, `DateField`, `TimeField`,
  `DatetimeField`, `UuidField`, `JsonField`, `ListField`, `MapField`,
  `BlobHexField`, `InetField`, `DurationField`.
- `client/src/utils/format.ts` (NEW) — value↔display formatters
  (mirrors legacy `format_value_for_display`).

**Behavior:**
- Collections (list/set/map): edited as JSON text; client serializes to
  JSON before submitting.
- UUID/TIMEUUID: empty value means server should auto-generate.
- Map columns with `display_type === 'JSON'` metadata: render as
  read-only formatted JSON in the data grid (the existing PR2 feature).

### Lane E — Raw CQL editor

**Files (server):**
- `server/src/routes/cql.ts` — implement.

**Files (client):**
- `client/src/api/cql.ts` (NEW).
- `client/src/components/CqlEditor/CqlEditor.tsx` — replace stub. Monaco
  with SQL language; Cmd/Ctrl+Enter to execute; results below.
- `client/src/components/CqlEditor/CqlResults.tsx` (NEW) — table view
  for SELECT, success/error message for DDL/DML.

**Behavior:**
- Empty query → `{ success: true, rows: [], message: 'Empty query',
  pagingState: null, hasMorePages: false }`.
- Errors → `{ success: false, message: error.message }`.

### Lane F — Per-column metadata + table info

**Files (server):**
- `server/src/routes/metadata.ts` — implement; uses
  `config/store.getColumnMetadata` / `setColumnMetadata`.

**Files (client):**
- `client/src/api/metadata.ts` (NEW).
- `client/src/components/TableInfo/TableInfo.tsx` — replace stub.
  5-column readout: name, type, key kind, hide checkbox, "Edit Map
  Schema" button (only for map columns).
- `client/src/components/Dialogs/MapSchemaEditor.tsx` (NEW).

**Behavior:**
- `display_type` options for `text` columns: `["text", "JSON"]`. When
  `JSON`, the data grid renders the value as `<pre>{formatted}</pre>`
  (matches PR2 of the legacy work).
- `hide` toggle removes the column from the data grid view.
- `map_schema` is a list of `{ key, label }` for a map column; the map
  field uses these as known keys (autocomplete-style).

## Coordination rules

1. Do not edit files owned by another lane. If you need a new shared
   type, add it to `shared/src/types/` and export from
   `shared/src/index.ts`.
2. Do not edit `client/src/App.tsx` — its layout is the integration
   contract. Replace stubs in their existing files only.
3. Do not edit `server/src/app.ts` — its router mount paths are fixed.
4. Use `@kassandra/shared` imports, not relative paths into the shared
   workspace.
5. Server: every non-connection route starts with `const ctx =
   requireSession()`.
6. Server: validate request bodies with `zod`. On parse failure, throw;
   the error middleware turns it into a 400.
7. Client: use TanStack Query for reads, mutations for writes.
   Invalidate the relevant query keys on mutation success.

## Done criteria

A lane is done when:
- `pnpm --filter @kassandra/server build` (or `client build`) succeeds.
- `pnpm typecheck` passes.
- The corresponding feature works against a real Cassandra cluster
  (manual smoke test is fine — there is no test suite).

## Out of scope for v1

- Auth on the Express side (the app is single-user, runs locally).
- Test suite, ESLint config, CI changes (other than the Docker rewrite,
  which is already in the skeleton).
- Migration tooling for users with an existing
  `~/.kassandra/config.json` — the schema is compatible.
