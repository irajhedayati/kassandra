/**
 * The VERSION file records which Kassandra version wrote the configuration
 * directory. The migration framework compares it with the running version.
 */
import fs from 'node:fs';
import path from 'node:path';

export const VERSION_FILE_NAME = 'VERSION';

let appVersion: string | undefined;

/** Version of the running server, read from server/package.json (present in dev, dist and Docker). */
export function getAppVersion(): string {
  if (appVersion === undefined) {
    const pkg = new URL('../../package.json', import.meta.url);
    appVersion = (JSON.parse(fs.readFileSync(pkg, 'utf-8')) as { version: string }).version;
  }
  return appVersion;
}

/** Version recorded in `dir`, or null when there is no VERSION file. */
export function readConfigVersion(dir: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, VERSION_FILE_NAME), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function writeConfigVersion(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, VERSION_FILE_NAME), `${version}\n`, 'utf-8');
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
 * Give a config directory without a VERSION file one: a brand-new directory is
 * stamped with the running version, a pre-versioning one with LEGACY_VERSION so
 * that migrations know to upgrade it.
 */
export function initConfigVersion(dir: string, appVersion: string = getAppVersion()): void {
  if (readConfigVersion(dir) !== null) return;
  const hasConfig = fs.existsSync(path.join(dir, 'config.json'));
  writeConfigVersion(dir, hasConfig ? LEGACY_VERSION : appVersion);
}
