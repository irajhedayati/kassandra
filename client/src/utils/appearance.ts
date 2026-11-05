export type Appearance = 'light' | 'dark' | 'system';

export const APPEARANCES: readonly Appearance[] = ['light', 'dark', 'system'];

/** Anything that is not a known choice (missing, corrupted storage) means follow the system. */
export function parseAppearance(value: unknown): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Whether the dark theme applies for `appearance` given the OS preference. */
export function isDark(appearance: Appearance, systemPrefersDark: boolean): boolean {
  return appearance === 'system' ? systemPrefersDark : appearance === 'dark';
}
