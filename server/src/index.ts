/**
 * Server entrypoint. Single-process: serves the API + the built React SPA.
 *
 * Dev: Vite runs the client on its own port and proxies /api to this server.
 * Prod: client/dist is served as static + SPA fallback to index.html.
 */
import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { closeAllSessions } from './cassandra/state.js';

const PORT = Number(process.env.PORT ?? 8501);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = createApp();

/** URLs the server can be reached at; a wildcard bind expands to localhost + every external IPv4. */
function listeningUrls(): string[] {
  if (HOST !== '0.0.0.0') return [`http://${HOST}:${PORT}`];
  const external = Object.values(networkInterfaces())
    .flatMap((addrs) => addrs ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  return ['localhost', ...external].map((h) => `http://${h}:${PORT}`);
}

app.listen(PORT, HOST, () => {
  console.log(`[kassandra] listening on:\n${listeningUrls().map((u) => `  ${u}`).join('\n')}`);
});

// Close every tab's driver connection on the way out.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void closeAllSessions().finally(() => process.exit(0));
  });
}
