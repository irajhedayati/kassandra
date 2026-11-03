/**
 * Configuration migrations.
 *
 * Any change to the shape of the configuration directory must ship with a
 * migration file `vX_Y_Z.ts` here, registered in MIGRATIONS below. On startup
 * runMigrations() compares the config directory's VERSION with the migrations
 * and applies the pending ones in version order, recording each in VERSION as
 * it completes so a failed run resumes where it stopped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '../store.js';
import {
  compareVersions,
  getAppVersion,
  initConfigVersion,
  readConfigVersion,
  writeConfigVersion,
} from '../version.js';
import { migration as v1_6_0 } from './v1_6_0.js';

export interface Migration {
  /** Version the configuration is at after `up` has run. */
  version: string;
  description: string;
  up(ctx: { dir: string }): void;
}

/** Oldest first. */
export const MIGRATIONS: Migration[] = [v1_6_0];

/** Returns the versions that were applied. */
export function runMigrations(
  dir: string = getConfigDir(),
  migrations: Migration[] = MIGRATIONS,
  appVersion: string = getAppVersion(),
): string[] {
  initConfigVersion(dir, appVersion);
  let current = readConfigVersion(dir)!;
  if (compareVersions(current, appVersion) > 0) {
    console.warn(
      `[kassandra] config in ${dir} was written by ${current}, newer than this version (${appVersion})`,
    );
    return [];
  }

  const pending = migrations
    .filter((m) => compareVersions(m.version, current) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));

  if (pending.length > 0) backupConfig(dir, current);

  const applied: string[] = [];
  for (const m of pending) {
    console.log(`[kassandra] migrating config ${current} -> ${m.version}: ${m.description}`);
    try {
      m.up({ dir });
    } catch (err) {
      throw new Error(
        `Config migration to ${m.version} failed (config stays at ${current}; a backup of config.json was kept): ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
    writeConfigVersion(dir, m.version);
    current = m.version;
    applied.push(m.version);
  }

  if (compareVersions(current, appVersion) < 0) writeConfigVersion(dir, appVersion);
  return applied;
}

function backupConfig(dir: string, version: string): void {
  const file = path.join(dir, 'config.json');
  const backup = `${file}.bak-${version}`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
}
