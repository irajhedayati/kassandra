/**
 * First-run state and moving the configuration to another directory
 * (the Configuration page).
 */
import type { ChangeLocationResult, SetupInfo } from '@kassandra/shared';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FileStorage } from './fileStorage.js';
import {
  defaultConfigDir,
  ensureWritableDir,
  expandLocation,
  getConfigDir,
  hasSavedLocation,
  isLocationLocked,
  LocationError,
  saveLocation,
} from './location.js';
import { runMigrations } from './migrations/index.js';
import { serialize } from './serial.js';

let firstRun: boolean | null = null;

function detectFirstRun(): boolean {
  return (
    !isLocationLocked() &&
    !hasSavedLocation() &&
    !existsSync(path.join(defaultConfigDir(), 'config.json'))
  );
}

/**
 * Decide whether this is a first run. Call once at startup, before anything
 * creates the default configuration, so an existing install is not mistaken
 * for a new one (or the other way around).
 */
export function initSetupState(): void {
  firstRun = detectFirstRun();
}

export function getSetupInfo(): SetupInfo {
  firstRun ??= detectFirstRun();
  return {
    firstRun,
    location: getConfigDir(),
    defaultLocation: defaultConfigDir(),
    locked: isLocationLocked(),
  };
}

/**
 * Switch the configuration to `input`. A location that already holds a
 * configuration is used as is; an empty one receives a copy of the current
 * configuration (backups excluded, the old location is left untouched). The
 * new location is migrated to the running version before it becomes active.
 */
export function changeLocation(input: string): Promise<ChangeLocationResult> {
  return serialize(async () => {
    if (isLocationLocked()) {
      throw new LocationError('The location is set by KASSANDRA_HOME and cannot be changed here', 409);
    }
    const target = expandLocation(input);
    await ensureWritableDir(target);

    const source = path.resolve(getConfigDir());
    let copied = 0;
    let existing = false;
    if (target !== source) {
      const from = new FileStorage(source);
      const to = new FileStorage(target);
      existing = (await to.list('')).length > 0;
      if (!existing) {
        for (const key of (await from.list('')).filter((k) => !k.startsWith('backups/'))) {
          const value = await from.get(key);
          if (value !== undefined) await to.put(key, value);
          copied++;
        }
        const version = await from.getVersion();
        if (version) await to.setVersion(version);
      }
      await runMigrations(to);
    }

    saveLocation(target);
    firstRun = false;
    return { ...getSetupInfo(), copied, existing };
  });
}
