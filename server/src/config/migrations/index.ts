/**
 * Configuration migrations.
 *
 * Any change to the shape of the configuration must ship with a migration file
 * `vX_Y_Z.ts` here, registered in MIGRATIONS below. On startup runMigrations()
 * compares the storage's version with the migrations and applies the pending
 * ones in version order, recording each as it completes so a failed run
 * resumes where it stopped. Migrations only talk to ConfigStorage, so they
 * work with every backend.
 */
import type { ConfigStorage, LockOptions } from '../storage.js';
import { getStorage } from '../storage.js';
import { compareVersions, getAppVersion, initConfigVersion } from '../version.js';
import { migration as v1_6_0 } from './v1_6_0.js';

export interface Migration {
  /** Version the configuration is at after `up` has run. */
  version: string;
  description: string;
  up(ctx: { storage: ConfigStorage }): Promise<void>;
}

/** Oldest first. */
export const MIGRATIONS: Migration[] = [v1_6_0];

const BACKUPS_PREFIX = 'backups/';

function pendingFor(migrations: Migration[], current: string): Migration[] {
  return migrations
    .filter((m) => compareVersions(m.version, current) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** Returns the versions that were applied. */
export async function runMigrations(
  storage: ConfigStorage = getStorage(),
  migrations: Migration[] = MIGRATIONS,
  appVersion: string = getAppVersion(),
  lockOptions: LockOptions = {},
): Promise<string[]> {
  await initConfigVersion(storage, appVersion);
  let current = (await storage.getVersion())!;
  if (compareVersions(current, appVersion) > 0) {
    console.warn(
      `[kassandra] config in ${storage.description} was written by ${current}, newer than this version (${appVersion})`,
    );
    return [];
  }

  const applied: string[] = [];
  if (pendingFor(migrations, current).length > 0) {
    const release = await storage.lock(lockOptions);
    try {
      // Another process may have migrated while we waited for the lock.
      current = (await storage.getVersion()) ?? current;
      const pending = pendingFor(migrations, current);
      if (pending.length > 0) await backup(storage, current);
      for (const m of pending) {
        console.log(`[kassandra] migrating config ${current} -> ${m.version}: ${m.description}`);
        try {
          await m.up({ storage });
        } catch (err) {
          throw new Error(
            `Config migration to ${m.version} failed (config stays at ${current}; a backup was kept under ${BACKUPS_PREFIX}${current}/): ${
              err instanceof Error ? err.message : String(err)
            }`,
            { cause: err },
          );
        }
        await storage.setVersion(m.version);
        current = m.version;
        applied.push(m.version);
      }
    } finally {
      await release();
    }
  }

  if (compareVersions(current, appVersion) < 0) await storage.setVersion(appVersion);
  return applied;
}

/** Copy every document (config, tables/, ...) except earlier backups to backups/<version>/. */
async function backup(storage: ConfigStorage, version: string): Promise<void> {
  const prefix = `${BACKUPS_PREFIX}${version}/`;
  if ((await storage.list(prefix)).length > 0) return;
  try {
    for (const key of await storage.list('')) {
      if (key.startsWith(BACKUPS_PREFIX)) continue;
      const value = await storage.get(key);
      if (value !== undefined) await storage.put(`${prefix}${key}`, value);
    }
  } catch (err) {
    throw new Error(
      `Could not back up the config before migrating: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
