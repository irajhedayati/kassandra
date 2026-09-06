import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import lockfile from '../package-lock.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MONACO_VERSION': JSON.stringify(
      lockfile.packages['node_modules/monaco-editor'].version,
    ),
  },
  resolve: {
    // Workspace dependencies are hoisted to the repository root. Force them
    // to share the client's React runtime instead of loading a second copy.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8501',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
