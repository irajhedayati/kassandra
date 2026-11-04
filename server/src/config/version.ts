/**
 * The storage's version records which Kassandra version wrote the configuration
 * (the VERSION file for file storage). The migration runner compares it with
 * the running version.
 */
import fs from 'node:fs';
import type { ConfigStorage } from './storage.js';

let appVersion: string | undefined;

/** Version of the running server, read from server/package.json (present in dev, dist and Docker). */
export function getAppVersion(): string {
  if (appVersion === undefined) {
    const pkg = new URL('../../package.json', import.meta.url);
    appVersion = (JSON.parse(fs.readFileSync(pkg, 'utf-8')) as { version: string }).version;
  }
  return appVersion;
}

/**
 * Last release before the VERSION file existed. A config directory that has a
 * config.json but no VERSION was written by it (or an older, same-shaped one).
 */
export const LEGACY_VERSION = '1.5.0';

/** Numeric semver comparison (prerelease/build suffixes ignored): negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Give storage without a recorded version one: brand-new storage is stamped
 * with the running version, pre-versioning data with LEGACY_VERSION so that
 * migrations know to upgrade it.
 */
export async function initConfigVersion(
  storage: ConfigStorage,
  appVersion: string = getAppVersion(),
): Promise<void> {
  if ((await storage.getVersion()) !== null) return;
  const hasConfig = (await storage.list('config')).includes('config');
  await storage.setVersion(hasConfig ? LEGACY_VERSION : appVersion);
}
