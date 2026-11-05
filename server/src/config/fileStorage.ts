/**
 * ConfigStorage backed by a directory: key `a/b` is the file `<dir>/a/b.json`,
 * the version is the plain-text file `<dir>/VERSION`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './location.js';
import type { ConfigStorage, LockOptions } from './storage.js';

const VERSION_FILE_NAME = 'VERSION';
const LOCK_FILE_NAME = '.migrate.lock';
const SEGMENT = /^[A-Za-z0-9_%][A-Za-z0-9_%.-]*$/;

export { getConfigDir };

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FileStorage implements ConfigStorage {
  constructor(readonly dir: string) {}

  get description(): string {
    return this.dir;
  }

  private file(key: string): string {
    const segments = key.split('/');
    if (!segments.every((s) => SEGMENT.test(s))) throw new Error(`Invalid storage key: ${key}`);
    const parts = [...segments];
    parts[parts.length - 1] += '.json';
    return path.join(this.dir, ...parts);
  }

  async get(key: string): Promise<unknown | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(key), 'utf-8');
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
    return JSON.parse(raw);
  }

  async put(key: string, value: unknown): Promise<void> {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write beside the target and rename so a crash never leaves a half-written file.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.file(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const walk = async (relDir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(path.join(this.dir, relDir), { withFileTypes: true });
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
      for (const entry of entries) {
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) await walk(rel);
        else if (entry.isFile() && entry.name.endsWith('.json')) keys.push(rel.slice(0, -'.json'.length));
      }
    };
    await walk('');
    return keys.filter((k) => k.startsWith(prefix)).sort();
  }

  async getVersion(): Promise<string | null> {
    try {
      return (await fs.readFile(path.join(this.dir, VERSION_FILE_NAME), 'utf-8')).trim() || null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async setVersion(version: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, VERSION_FILE_NAME), `${version}\n`, 'utf-8');
  }

  async lock({ timeoutMs = 60_000, staleMs = 300_000 }: LockOptions = {}): Promise<() => Promise<void>> {
    await fs.mkdir(this.dir, { recursive: true });
    const lock = path.join(this.dir, LOCK_FILE_NAME);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await fs.writeFile(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
        return () => fs.rm(lock, { force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      try {
        if (Date.now() - (await fs.stat(lock)).mtimeMs > staleMs) {
          console.warn('[kassandra] removing stale lock');
          await fs.rm(lock, { force: true });
          continue;
        }
      } catch {
        continue; // released between the open and the stat
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for another process to release ${lock}`);
      }
      await sleep(200);
    }
  }
}
