import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { loader } from '@monaco-editor/react';
import '@fontsource-variable/inter';
import { App } from './App.js';
import './index.css';

// Keep both editors' CDN runtime aligned with the installed Monaco package.
loader.config({
  paths: {
    vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${import.meta.env.VITE_MONACO_VERSION}/min/vs`,
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
