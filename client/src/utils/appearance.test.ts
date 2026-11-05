import { describe, expect, it } from 'vitest';
import { isDark, parseAppearance } from './appearance.js';

describe('parseAppearance', () => {
  it('accepts the explicit choices', () => {
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('system')).toBe('system');
  });

  it('falls back to system for anything else', () => {
    for (const v of [null, undefined, '', 'Dark', 'auto', 1, {}]) {
      expect(parseAppearance(v)).toBe('system');
    }
  });
});

describe('isDark', () => {
  it('follows the OS only for system', () => {
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });

  it('ignores the OS for an explicit choice', () => {
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
  });
});
