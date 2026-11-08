# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

kassandra is a web-based GUI client for Apache Cassandra. It is a Node.js + React/TypeScript app that runs as a single
process: an Express server serves both the JSON API and the built React SPA on one port.

The previous Python/Streamlit implementation lives under [`legacy/`](legacy/) for reference during the rewrite. Treat it
as read-only; feature behavior should match its semantics.

## Development Commands

```bash
# Setup
npm install

# Dev (server on 8501, Vite on 5173 with /api proxy)
npm run dev

# Build all workspaces
npm run build

# Production-style run (Express serves API + client/dist)
npm start

# Type-check only
npm run typecheck

# Run unit tests (all workspaces)
npm run test

# Integration tests: starts throwaway PostgreSQL and MySQL containers with Docker, runs
# *.integration.test.ts against it, removes it (or set KASSANDRA_TEST_POSTGRES_URL / KASSANDRA_TEST_MYSQL_URL to use your own)
npm run test:integration

# Docker
docker build -t kassandra .
docker run -p 8501:8501 kassandra
```

Unit tests use Vitest, one config-free `test` script per workspace (`shared`, `server`, `client`); `*.integration.test.ts`
files are left out of it and need Docker (`npm run test:integration`). There is no linting configuration in this project.

## Architecture

npm workspaces monorepo:

```
shared/  ; TypeScript types shared by server and client (connection, schema, query, cql-types)
server/  ; Express + cassandra-driver
client/  ; React 18 + Vite + Tailwind + TanStack Query
legacy/  ; original Python/Streamlit app (reference only)
```

### Server (`server/src/`)

- `index.ts` / `app.ts`; entrypoint and Express app factory; mounts routers under `/api/*` and falls back to serving
  `client/dist/index.html` for SPA routes.
- `cassandra/state.ts`; singleton holding the active `Client` and current profile. The connection routes set it; every
  other route calls `requireSession()`.
- `cassandra/connection.ts`; connect/disconnect lifecycle, SSL, auth, execution profile.
- `cassandra/schema.ts`; `system_schema` introspection (keyspaces, tables, columns).
- `cassandra/repository.ts`; row CRUD using prepared statements; paging-state is base64-encoded for the wire.
- `config/repository.ts`; `ConfigRepository`, the interface every config backend implements: domain operations (profiles, last connection, favorites, saved queries, table metadata) plus `migrate()`, version, snapshot export/import and a cross-process lock. `config/repository.contract.ts` is the test suite each backend must pass. `config/registry.ts`; named backends (`file`, `sqlite`, plus `registerStorageBackend()`), `getRepository()` returns the active one.
- `config/storage.ts`; `ConfigStorage`, the key -> JSON-document layer under `DocumentRepository` (`config/documentRepository.ts`: `config` + `tables/*` documents, the default `file` backend, and any future document store). `config/storage.contract.ts` is its test suite.
- `config/location.ts`; where the config lives: `KASSANDRA_HOME`, else the path saved by the Configuration page in
  `~/.kassandra/.location`, else `~/.kassandra`. `config/setup.ts` holds the first-run state (decided once at startup)
  and `changeLocation()`, which copies to an empty target, migrates it and then switches.
- `config/backend.ts`; which backend is active (`KASSANDRA_STORAGE`, else the choice saved in `~/.kassandra/.backend`, else `file`), the SQLite path (`KASSANDRA_SQLITE_PATH`, else saved, else `<config dir>/kassandra.db`) and the PostgreSQL/MySQL connection (`KASSANDRA_DB_URL` plus `KASSANDRA_DB_SCHEMA`, else saved). `setup.ts#changeStorage()` switches backend, migrating the target and copying a snapshot into it if it is empty.
- `config/sqlite/`; SQLite backend (better-sqlite3 + Drizzle): `schema.ts` is the relational schema, `repository.ts` the `SqliteRepository`, and the SQL migrations live in `server/drizzle/` (generated, committed). Change the schema with `npm run db:generate -w server`, never by editing applied migration files.
- `config/sql/`; the relational backends, PostgreSQL and MySQL/MariaDB (`mysql` also covers MariaDB), on one dialect-aware layer (Kysely + pg/mysql2): `connection.ts` the connection settings and `KASSANDRA_DB_URL` parsing, `dialect.ts` what differs between the databases (pools, duplicate-key errors, ordering), `schema.ts` the Kysely table types, `migrations.ts` the migrations (one definition generating the schema for both; add an entry for every schema change, never edit a shipped one; MySQL needs varchar keys, table-level foreign keys and `if not exists` since its DDL is not transactional) and `repository.ts` the `SqlRepository`. Selected with `KASSANDRA_STORAGE=postgres|mysql` plus `KASSANDRA_DB_URL` (`postgres://user:pw@host:5432/db`, `mysql://...`; `KASSANDRA_DB_SCHEMA` for the PostgreSQL schema, default `public`), or on the Configuration page (host, port, database, user, password, TLS), which saves the connection (password included, so the file is mode 0600) in `~/.kassandra/.backend`. The password never leaves the server: `SetupInfo.sql` only has `hasPassword`, and a request without a password keeps the saved one. Its tests are the `*.integration.test.ts` files here, run for each database by `server/scripts/test-integration.mjs` (the repository contract plus database specifics, and switching from the Configuration page); `testing.ts` creates an isolated schema/database per test.
- `config/fileStorage.ts`; default backend: `${KASSANDRA_HOME ?? ~/.kassandra}/<key>.json` (`config.json`,
  `tables/*.json`) plus a plain-text `VERSION` file.
- `config/store.ts`; settings (profiles, favorites, saved queries) and column metadata on top of `ConfigStorage`. All
  functions are async and run one at a time (`config/serial.ts`) so concurrent requests cannot overwrite each other.
- `config/tables.ts`; per-table metadata documents (`tables/<connection>-<keyspace>.<table>`), naming and validation.
- `config/version.ts`; the running version, version comparison, and stamping storage that has no version (legacy data
  counts as `1.5.0`).
- `config/migrations/`; one `vX_Y_Z.ts` per config-shape change, registered in `index.ts`; `runMigrations()` runs at
  startup, takes the storage lock, backs everything up to `backups/<version>/` and applies those newer than the stored
  version, in order. Migrations only use `ConfigStorage` (they apply to the file backend; SQLite uses Drizzle migrations). Any change to the config layout must add a migration (see
  CONTRIBUTING.md).
- `routes/*`; one file per feature (`connection`, `schema`, `data`, `cql`, `metadata`).

### Client (`client/src/`)

- `App.tsx`; sidebar + tabbed main panel. Reads connection status and selection from global stores.
- `state/connection.ts`; TanStack Query hook for `/api/profiles/status`.
- `state/selection.ts`; Zustand store for the active keyspace + table.
- `state/appearance.ts`; Light/Dark/System (localStorage; toggles the `dark` class on `<html>`; also picks the Monaco
  theme). The palette is `@theme` variables in `index.css` and the dark theme is a `.dark` override block there, so
  components rarely need `dark:` classes. The always-navy sidebar uses the never-overridden `ink-*` copy of the slate
  scale instead of `slate-*`.
- `api/client.ts`; typed fetch wrapper; throws `ApiError` on non-OK responses.
- `components/Sidebar/`; `ConnectionPanel`, `SchemaNavigator`.
- `components/DataGrid/`; paginated table view.
- `components/Forms/`; schema-driven dynamic form (insert/update).
- `components/TableInfo/`; column metadata panel.
- `components/Configuration/`; Configuration page (config location); shown instead of the app on the first run, and from
  the gear in the sidebar footer.
- `components/CqlEditor/`; Monaco-based raw CQL editor.

### Important Patterns

- **Schema-driven UI**; all forms/grids are generated from `TableSchema` at runtime; no hardcoded column definitions.
- **Prepared statements**; all CRUD uses `cassandra-driver` parameter binding. The legacy Python code had a
  SQL-injection bug in UPDATE; the rewrite must use binding everywhere.
- **Paging state**; Cassandra's opaque `pageState` (Buffer) is base64-encoded as `pagingState` in `QueryResult` so the
  client can pass it back unchanged.
- **Single process**; in dev, Vite proxies `/api`; in prod, Express serves both. `client/dist` is colocated under
  `app/client/dist` in the Docker image.
- **Type contract**; `shared/` is the single source of truth for cross-process shapes. Server and client both import
  from `@kassandra/shared`.
