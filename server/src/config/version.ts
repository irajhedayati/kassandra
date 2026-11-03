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

/** Stamp a config directory that has no VERSION file (new or pre-versioning) with the running version. */
export function initConfigVersion(dir: string): void {
  if (readConfigVersion(dir) === null) writeConfigVersion(dir, getAppVersion());
}
