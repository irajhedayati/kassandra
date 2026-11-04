import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStorage } from './fileStorage.js';
import { describeStorageContract } from './storage.contract.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kassandra-'));

describeStorageContract('FileStorage', () => {
  const dir = tmp();
  return { storage: new FileStorage(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
});

describe('FileStorage layout', () => {
  it('maps keys to files and the version to a plain-text VERSION file', async () => {
    const dir = tmp();
    try {
      const s = new FileStorage(dir);
      await s.put('config', { a: 1 });
      await s.put('tables/c-ks.t', { b: 2 });
      await s.setVersion('1.6.0');
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'))).toEqual({ a: 1 });
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'tables', 'c-ks.t.json'), 'utf-8'))).toEqual({ b: 2 });
      expect(fs.readFileSync(path.join(dir, 'VERSION'), 'utf-8')).toBe('1.6.0\n');
      expect(fs.readdirSync(dir).sort()).toEqual(['VERSION', 'config.json', 'tables']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores files that are not JSON documents', async () => {
    const dir = tmp();
    try {
      const s = new FileStorage(dir);
      await s.put('config', {});
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
      fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.0\n');
      expect(await s.list('')).toEqual(['config']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects keys that could leave the directory', async () => {
    const s = new FileStorage(tmp());
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '', '.hidden', 'a b']) {
      await expect(s.get(key)).rejects.toThrow(/Invalid storage key/);
      await expect(s.put(key, {})).rejects.toThrow(/Invalid storage key/);
    }
  });

  it('rejects when a document is not valid JSON, and does not leave temp files behind', async () => {
    const dir = tmp();
    try {
      const s = new FileStorage(dir);
      fs.writeFileSync(path.join(dir, 'config.json'), '{nope');
      await expect(s.get('config')).rejects.toThrow();
      await s.put('config', { ok: true });
      expect(fs.readdirSync(dir)).toEqual(['config.json']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
