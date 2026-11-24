/**
 * Common setup for client component tests, loaded by every helper in this
 * folder (import from `../test/index.js`, which component tests do anyway).
 *
 * - jest-dom matchers (`toBeInTheDocument`, `toBeDisabled`, ...);
 * - after each test: unmount what was rendered, check that no unexpected API
 *   request was made (see `mockApi`), undo global stubs, and reset the Zustand
 *   stores and browser storage, so tests don't leak into each other;
 * - stubs for browser APIs jsdom doesn't implement but the app uses.
 *
 * Component tests run in jsdom: start the test file with `// @vitest-environment jsdom`.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { useSelection } from '../state/selection.js';
import { useCqlDraft } from '../state/cqlDraft.js';
import { verifyApiMock } from './api.js';

// Initial state of every Zustand store, to restore after each test.
const stores = [
  [useSelection, useSelection.getState()],
  [useCqlDraft, useCqlDraft.getState()],
] as const;

if (typeof window !== 'undefined') {
  // Appearance (System theme) asks for the colour scheme.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  // The row details panel scrolls itself into view.
  Element.prototype.scrollIntoView ??= () => {};
}

afterEach(() => {
  cleanup();
  try {
    verifyApiMock();
  } finally {
    vi.unstubAllGlobals();
    for (const [store, initial] of stores) (store as { setState(s: unknown, replace: true): void }).setState(initial, true);
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  }
});
