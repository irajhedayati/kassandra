/**
 * The VERSION file records which Kassandra version wrote the configuration
 * directory. The migration framework compares it with the running version.
 */
import fs from 'node:fs';
import path from 'node:path';

export const VERSION_FILE_NAME = 'VERSION';

/** Version assumed for config directories created before VERSION existed. */
export const BASELINE_VERSION = '0.0.0';

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
 * Version that wrote the config in `dir`; null when the directory holds no
 * config at all. An existing config without a VERSION file predates versioning.
 */
export function readConfigVersion(dir: string): string | null {
  try {
    const value = fs.readFileSync(path.join(dir, VERSION_FILE_NAME), 'utf-8').trim();
    if (value !== '') return value;
  } catch {
    // fall through to the legacy check
  }
  return fs.existsSync(path.join(dir, 'config.json')) ? BASELINE_VERSION : null;
}

export function writeConfigVersion(dir: string, version: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, VERSION_FILE_NAME), `${version}\n`, 'utf-8');
}

/** Stamp a brand-new config directory with the running version; leaves existing ones alone. */
export function initConfigVersion(dir: string): void {
  if (readConfigVersion(dir) === null) writeConfigVersion(dir, getAppVersion());
}
