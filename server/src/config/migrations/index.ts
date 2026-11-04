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

const BACKUPS_DIR_NAME = 'backups';
const LOCK_FILE_NAME = '.migrate.lock';

export interface RunOptions {
  /** How long to wait for another process's migration to finish. */
  lockTimeoutMs?: number;
  /** A lock older than this is assumed to belong to a crashed process. */
  lockStaleMs?: number;
}

function pendingFor(migrations: Migration[], current: string): Migration[] {
  return migrations
    .filter((m) => compareVersions(m.version, current) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** Returns the versions that were applied. */
export function runMigrations(
  dir: string = getConfigDir(),
  migrations: Migration[] = MIGRATIONS,
  appVersion: string = getAppVersion(),
  options: RunOptions = {},
): string[] {
  initConfigVersion(dir, appVersion);
  let current = readConfigVersion(dir)!;
  if (compareVersions(current, appVersion) > 0) {
    console.warn(
      `[kassandra] config in ${dir} was written by ${current}, newer than this version (${appVersion})`,
    );
    return [];
  }

  const applied: string[] = [];
  if (pendingFor(migrations, current).length > 0) {
    const release = acquireLock(dir, options);
    try {
      // Another process may have migrated while we waited for the lock.
      current = readConfigVersion(dir) ?? current;
      const pending = pendingFor(migrations, current);
      if (pending.length > 0) backupConfig(dir, current);
      for (const m of pending) {
        console.log(`[kassandra] migrating config ${current} -> ${m.version}: ${m.description}`);
        try {
          m.up({ dir });
        } catch (err) {
          throw new Error(
            `Config migration to ${m.version} failed (config stays at ${current}; a backup was kept in ${path.join(dir, BACKUPS_DIR_NAME, current)}): ${
              err instanceof Error ? err.message : String(err)
            }`,
            { cause: err },
          );
        }
        writeConfigVersion(dir, m.version);
        current = m.version;
        applied.push(m.version);
      }
    } finally {
      release();
    }
  }

  if (compareVersions(current, appVersion) < 0) writeConfigVersion(dir, appVersion);
  return applied;
}

/**
 * Copy everything in the config directory (config.json, tables/, ...) except
 * earlier backups into backups/<version>/ before migrating away from it.
 */
function backupConfig(dir: string, version: string): void {
  const target = path.join(dir, BACKUPS_DIR_NAME, version);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name === BACKUPS_DIR_NAME || name === LOCK_FILE_NAME) continue;
    fs.cpSync(path.join(dir, name), path.join(target, name), { recursive: true });
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Cross-process lock so replicas sharing one config directory (e.g. a mounted
 * volume) do not migrate at the same time. Waits for a holder to finish and
 * takes over a lock older than `lockStaleMs`. Returns the release function.
 */
function acquireLock(dir: string, { lockTimeoutMs = 60_000, lockStaleMs = 300_000 }: RunOptions): () => void {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, LOCK_FILE_NAME);
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > lockStaleMs) {
        console.warn('[kassandra] removing stale migration lock');
        fs.rmSync(lock, { force: true });
        continue;
      }
    } catch {
      continue; // released between the open and the stat
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another process to finish migrating ${dir} (lock: ${lock})`);
    }
    sleep(200);
  }
}
