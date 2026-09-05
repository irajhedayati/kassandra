# kassandra: Cassandra GUI Client

<p align="center">
  <img src="logo.png" alt="Kassandra — GUI for Cassandra databases" width="360">
</p>

A web-based graphical client for Apache Cassandra. Schema-driven CRUD, raw CQL execution, and connection profile management.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-26%2B-green)
![React](https://img.shields.io/badge/react-19-blue)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)
[![GitHub Release](https://img.shields.io/github/v/release/irajhedayati/py-sandra)](https://github.com/irajhedayati/py-sandra/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/hedayati/kassandra)](https://hub.docker.com/r/hedayati/kassandra)
[![Docker Image Size](https://img.shields.io/docker/image-size/hedayati/kassandra/latest)](https://hub.docker.com/r/hedayati/kassandra)
[![Open Issues](https://img.shields.io/github/issues/irajhedayati/py-sandra)](https://github.com/irajhedayati/py-sandra/issues)
[![Last Commit](https://img.shields.io/github/last-commit/irajhedayati/py-sandra)](https://github.com/irajhedayati/py-sandra/commits)
[![CI](https://github.com/irajhedayati/kassandra/actions/workflows/docker-image.yml/badge.svg)](https://github.com/irajhedayati/py-sandra/actions/workflows/ci.yml)
[![CI](https://github.com/irajhedayati/kassandra/actions/workflows/release.yml/badge.svg)](https://github.com/irajhedayati/py-sandra/actions/workflows/ci.yml)

## Stack

- **Server:** Node.js + Express + TypeScript, using the official DataStax `cassandra-driver`.
- **Client:** React 18 + TypeScript + Vite + Tailwind CSS, with TanStack Query for server state and Zustand for client state.
- **Single process:** Express serves the API and the built React SPA on one port.

```shell
nvm install v26
nvm use v26.8.1 # whatever version installed
```

The previous Python/Streamlit implementation lives under [`legacy/`](legacy) for reference.

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
docker build -t kassandra .
docker run -p 8501:8501 kassandra
```

## Configuration

Connection profiles and per-column metadata are persisted to `~/.kassandra/config.json`. Override the directory with `KASSANDRA_HOME`.

### Datacenter selection

Each connection profile has an optional **Local datacenter** field. When set, the driver uses a DC-aware load-balancing policy: queries route to nodes in the named DC first, and only fall back to remote DCs if the local one becomes unreachable.

Useful for:

- **Local-first reads** to minimize cross-region latency.
- **Compliance / data residency** requirements that pin reads to a specific region.
- **Failover testing** of how the app behaves when a DC is down.

If you set a DC that doesn't exist in the cluster, the app refuses to connect and shows the list of available DC names — no silent fallback. Leaving the field empty preserves the prior behavior (plain round-robin over the configured contact points, no DC preference).

The form auto-completes the field from the currently-connected cluster's DC list (visible while editing if you're already connected to a cluster), so you don't have to memorize names. Programmatically, the list is also exposed at `GET /api/profiles/datacenters` while connected.

See [docs/index.md](docs/index.md) for the user guide.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
