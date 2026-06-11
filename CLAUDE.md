# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

py-sandra is a web-based GUI client for Apache Cassandra. It is a Node.js + React/TypeScript app that runs as a single process: an Express server serves both the JSON API and the built React SPA on one port.

The previous Python/Streamlit implementation lives under [`legacy/`](legacy/) for reference during the rewrite. Treat it as read-only — feature behavior should match its semantics.

## Development Commands

```bash
# Setup
pnpm install

# Dev (server on 8501, Vite on 5173 with /api proxy)
pnpm dev

# Build all workspaces
pnpm build

# Production-style run (Express serves API + client/dist)
pnpm start

# Type-check only
pnpm typecheck

# Docker
docker build -t py-sandra .
docker run -p 8501:8501 py-sandra
```

There is no test suite or linting configuration in this project.

## Architecture

pnpm workspace monorepo:

```
shared/   — TypeScript types shared by server and client (connection, schema, query, cql-types)
server/   — Express + cassandra-driver
client/   — React 18 + Vite + Tailwind + TanStack Query
legacy/   — original Python/Streamlit app (reference only)
```

### Server (`server/src/`)

- `index.ts` / `app.ts` — entrypoint and Express app factory; mounts routers under `/api/*` and falls back to serving `client/dist/index.html` for SPA routes.
- `cassandra/state.ts` — singleton holding the active `Client` and current profile. The connection routes set it; every other route calls `requireSession()`.
- `cassandra/connection.ts` — connect/disconnect lifecycle, SSL, auth, execution profile.
- `cassandra/schema.ts` — `system_schema` introspection (keyspaces, tables, columns).
- `cassandra/repository.ts` — row CRUD using prepared statements; paging-state is base64-encoded for the wire.
- `config/store.ts` — JSON persistence at `${PY_SANDRA_HOME ?? ~/.py-sandra}/config.json`.
- `routes/*` — one file per feature (`connection`, `schema`, `data`, `cql`, `metadata`).

### Client (`client/src/`)

- `App.tsx` — sidebar + tabbed main panel. Reads connection status and selection from global stores.
- `state/connection.ts` — TanStack Query hook for `/api/profiles/status`.
- `state/selection.ts` — Zustand store for the active keyspace + table.
- `api/client.ts` — typed fetch wrapper; throws `ApiError` on non-OK responses.
- `components/Sidebar/` — `ConnectionPanel`, `SchemaNavigator`.
- `components/DataGrid/` — paginated table view.
- `components/Forms/` — schema-driven dynamic form (insert/update).
- `components/TableInfo/` — column metadata panel.
- `components/CqlEditor/` — Monaco-based raw CQL editor.

### Important Patterns

- **Schema-driven UI** — all forms/grids are generated from `TableSchema` at runtime; no hardcoded column definitions.
- **Prepared statements** — all CRUD uses `cassandra-driver` parameter binding. The legacy Python code had a SQL-injection bug in UPDATE; the rewrite must use binding everywhere.
- **Paging state** — Cassandra's opaque `pageState` (Buffer) is base64-encoded as `pagingState` in `QueryResult` so the client can pass it back unchanged.
- **Single process** — in dev, Vite proxies `/api`; in prod, Express serves both. `client/dist` is colocated under `app/client/dist` in the Docker image.
- **Type contract** — `shared/` is the single source of truth for cross-process shapes. Server and client both import from `@py-sandra/shared`.
