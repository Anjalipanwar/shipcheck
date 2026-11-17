import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config.js';
import { checkOutputFolder } from '../../src/output-dir.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shipcheck-out-'));
});
afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe('checkOutputFolder (audit A-06)', () => {
  it('an existing folder: passes, keeps its files, leaves no test file behind', async () => {
    writeFileSync(join(dir, 'old.txt'), 'x');
    await checkOutputFolder(dir, 'out');
    expect(readdirSync(dir)).toEqual(['old.txt']);
  });

  it('a new nested folder: passes and removes every folder it created', async () => {
    await checkOutputFolder(join(dir, 'a', 'b', 'c'), 'a/b/c');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a file in the way: a plain ConfigError, the file untouched', async () => {
    writeFileSync(join(dir, 'report'), 'keep');
    const error = await checkOutputFolder(join(dir, 'report'), 'report').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('“report” cannot be written to');
    expect((error as Error).message).toContain('a file with that name is in the way');
    expect(existsSync(join(dir, 'report'))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a folder without write permission: a plain ConfigError',
    async () => {
      mkdirSync(join(dir, 'locked'));
      chmodSync(join(dir, 'locked'), 0o500);
      try {
        await expect(checkOutputFolder(join(dir, 'locked', 'out'), 'locked/out')).rejects.toThrow(
          /cannot be written to \(no permission\)/,
        );
      } finally {
        chmodSync(join(dir, 'locked'), 0o700);
      }
    },
  );
});
