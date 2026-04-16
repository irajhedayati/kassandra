# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

py-sandra is a web-based GUI client for Apache Cassandra, built with Python and Streamlit. It provides schema-driven CRUD, CQL execution, and connection profile management.

## Development Commands

```bash
# Setup
uv venv --python 3.12
uv sync

# Run
streamlit run src/main.py

# Docker build
docker build -t py-sandra .
docker run -p 8501:8501 py-sandra
```

There is no test suite or linting configuration in this project.

## Architecture

The app follows an MVC-inspired structure with Streamlit session state for persistence across UI reruns:

```
src/main.py           → Streamlit entry point
src/app.py            → CassandraGUIApp: main controller, session state, lifecycle
src/config/           → ConfigManager (JSON persistence at ~/.py-sandra/config.json)
src/database/         → connection.py, model.py, repository.py
src/view/             → Streamlit page/panel components
src/ui/               → Dynamic form generation
src/utils/            → Type mapping, SSL helpers, UUID validator
```

### Key Layers

**`src/app.py` (CassandraGUIApp)** — orchestrates everything: initializes components, manages connect/disconnect, routes callbacks from views to services.

**`src/database/connection.py` (CassandraConnectionManager)** — wraps the cassandra-driver: cluster connection, auth, SSL/TLS, prepared statement execution with configurable consistency levels, paging state tracking. Returns `QueryResult` objects.

**`src/database/model.py`** — domain models: `ColumnInfo`, `TableSchema` (partition/clustering keys), `Record`, and `SchemaInspector` (queries `system_schema` tables at runtime to discover table metadata).

**`src/database/repository.py` (CassandraRepository)** — CRUD operations using prepared statements; builds dynamic WHERE clauses, handles Cassandra collections and JSON.

**`src/config/settings.py`** — `ConnectionProfile` dataclass (hosts, port, auth, SSL, consistency, timeout) persisted as JSON; supports `PY_SANDRA_HOME` env var override.

**`src/view/`** — one file per UI panel: `main_view.py` (sidebar + content routing), `data_grid.py` (paginated table), `form.py` (insert/update), `connection_form.py`, `cql_view.py` (Monaco editor), `table_info.py`, `dialogs_view.py`.

**`src/ui/dynamic_form.py`** — generates type-appropriate Streamlit widgets from `TableSchema` metadata; handles collections (list/set/map) with specialized JSON editors.

### Important Patterns

- **Schema-driven UI**: all forms are generated dynamically from Cassandra metadata at runtime — never hardcoded.
- **Prepared statements**: all queries use parameter binding via `cassandra-driver` prepared statements.
- **Streamlit session state**: connection, schema selection, and pagination state all live in `st.session_state`; be careful about what triggers reruns.
- **Consistency levels**: configurable per connection profile; applied to every statement execution in `connection.py`.
- **Collections**: Cassandra `list`, `set`, `map` types need special handling — see `utils/type_mapping.py` and `ui/dynamic_form.py`.
