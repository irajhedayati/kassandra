# py-sandra: Cassandra GUI Client

A web-based graphical client for Apache Cassandra. Schema-driven CRUD, raw CQL execution, and connection profile management.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-20%2B-green)
![React](https://img.shields.io/badge/react-18-blue)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)

## Stack

- **Server:** Node.js + Express + TypeScript, using the official DataStax `cassandra-driver`.
- **Client:** React 18 + TypeScript + Vite + Tailwind CSS, with TanStack Query for server state and Zustand for client state.
- **Single process:** Express serves the API and the built React SPA on one port.

The previous Python/Streamlit implementation lives under [`legacy/`](legacy/) for reference.

## Develop

```bash
npm install
npm run dev      # runs the server (8501) and the Vite dev server (5173) in parallel
```

Open http://localhost:5173 — Vite proxies `/api` to the server on 8501.

## Build & run

```bash
npm run build
npm start    # serves API + built SPA on http://127.0.0.1:8501
```

## Docker

```bash
docker build -t py-sandra .
docker run -p 8501:8501 py-sandra
```

## Configuration

Connection profiles and per-column metadata are persisted to `~/.py-sandra/config.json`. Override the directory with `PY_SANDRA_HOME`.

See [docs/index.md](docs/index.md) for the user guide.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
