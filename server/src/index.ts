/**
 * Server entrypoint. Single-process: serves the API + the built React SPA.
 *
 * Dev: Vite runs the client on its own port and proxies /api to this server.
 * Prod: client/dist is served as static + SPA fallback to index.html.
 */
import { createApp } from './app.js';
import { closeAllSessions } from './cassandra/state.js';

const PORT = Number(process.env.PORT ?? 8501);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`[kassandra] listening on http://${HOST}:${PORT}`);
});

// Close every tab's driver connection on the way out.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void closeAllSessions().finally(() => process.exit(0));
  });
}
