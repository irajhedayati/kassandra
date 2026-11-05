/**
 * Where the configuration lives.
 *
 * Resolution order:
 *   1. KASSANDRA_HOME (the location is then fixed; Docker/Helm set it)
 *   2. the path saved by the Configuration page in ~/.kassandra/.location
 *   3. ~/.kassandra
 *
 * The pointer file can't live in the configuration it points to, so it always
 * sits in the default directory. It is a dotfile without a .json extension so
 * the file storage never lists it as a document.
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POINTER_FILE_NAME = '.location';

export class LocationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), '.kassandra');
}

function pointerFile(): string {
  return path.join(defaultConfigDir(), POINTER_FILE_NAME);
}

/** True when KASSANDRA_HOME fixes the location, so it cannot be changed from the UI. */
export function isLocationLocked(): boolean {
  const env = process.env.KASSANDRA_HOME;
  return !!env && env.trim() !== '';
}

/** Whether a location was ever chosen in the Configuration page. */
export function hasSavedLocation(): boolean {
  return existsSync(pointerFile());
}

function readPointer(): string | null {
  try {
    return readFileSync(pointerFile(), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function getConfigDir(): string {
  if (isLocationLocked()) return process.env.KASSANDRA_HOME!;
  return readPointer() ?? defaultConfigDir();
}

export function saveLocation(dir: string): void {
  mkdirSync(defaultConfigDir(), { recursive: true });
  writeFileSync(pointerFile(), `${dir}\n`, 'utf-8');
}

/** Resolve user input (absolute path or ~-relative) to an absolute path. */
export function expandLocation(input: string): string {
  const value = input.trim();
  if (value === '') throw new LocationError('Location is required', 400);
  const expanded =
    value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) {
    throw new LocationError('Location must be an absolute path (or start with ~/)', 400);
  }
  return path.resolve(expanded);
}

/** Create `dir` if needed and make sure it is a directory we can write to. */
export async function ensureWritableDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
    if (!(await fs.stat(dir)).isDirectory()) throw new Error('not a directory');
    const probe = path.join(dir, `.write-test-${process.pid}`);
    await fs.writeFile(probe, '');
    await fs.rm(probe, { force: true });
  } catch (err) {
    throw new LocationError(
      `Cannot use ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }
}
