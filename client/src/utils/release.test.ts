import { describe, expect, it } from 'vitest';
import { releaseUrl } from './release.js';

describe('releaseUrl', () => {
  it('links the release tag of a plain version', () => {
    expect(releaseUrl('1.6.0')).toBe('https://github.com/irajhedayati/kassandra/releases/tag/v1.6.0');
    expect(releaseUrl('12.30.4')).toBe('https://github.com/irajhedayati/kassandra/releases/tag/v12.30.4');
  });

  it('falls back to the latest release for missing, dev or pre-release versions', () => {
    const latest = 'https://github.com/irajhedayati/kassandra/releases/latest';
    for (const v of [undefined, '', 'dev', '1.6.0-rc.1', '1.6.0-SNAPSHOT', '1.6', 'v1.6.0', '1.6.0\n']) {
      expect(releaseUrl(v)).toBe(latest);
    }
  });
});
