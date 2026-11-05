/**
 * Light / Dark / System. The choice is a per-browser preference kept in
 * localStorage, so it applies before anything is fetched (and on the first-run
 * page). The dark theme is the `dark` class on <html>; index.html applies it
 * before the first paint, initAppearance() takes over from there.
 */
import { create } from 'zustand';
import { type Appearance, isDark, parseAppearance } from '../utils/appearance.js';

const STORAGE_KEY = 'kassandra.appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

interface AppearanceState {
  appearance: Appearance;
  /** The theme in effect, after resolving "system". */
  dark: boolean;
  setAppearance: (appearance: Appearance) => void;
}

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}

export const useAppearance = create<AppearanceState>((set) => {
  const initial = readStored();
  return {
    appearance: initial,
    dark: isDark(initial, systemPrefersDark()),
    setAppearance: (appearance) => {
      try {
        localStorage.setItem(STORAGE_KEY, appearance);
      } catch {
        // storage unavailable: the choice still applies for this page load
      }
      const dark = isDark(appearance, systemPrefersDark());
      applyTheme(dark);
      set({ appearance, dark });
    },
  };
});

/** Apply the stored choice and follow OS changes while it is "system". Call once at startup. */
export function initAppearance(): void {
  applyTheme(useAppearance.getState().dark);
  if (typeof matchMedia !== 'function') return;
  matchMedia(DARK_QUERY).addEventListener('change', () => {
    const { appearance } = useAppearance.getState();
    if (appearance !== 'system') return;
    const dark = isDark(appearance, systemPrefersDark());
    applyTheme(dark);
    useAppearance.setState({ dark });
  });
}

/** Theme name for Monaco editors. */
export function useMonacoTheme(): 'vs-dark' | 'vs-light' {
  return useAppearance((s) => (s.dark ? 'vs-dark' : 'vs-light'));
}
