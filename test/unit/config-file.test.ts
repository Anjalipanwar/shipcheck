import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, ConfigError, loadConfig, readConfigFile } from '../../src/config.js';

describe('shipcheck.config.json', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipcheck-config-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (content: string) => writeFileSync(join(dir, CONFIG_FILE), content);

  it('no file → no settings', () => {
    expect(readConfigFile(dir)).toEqual({});
  });

  it('mirrors the flags', () => {
    write(
      JSON.stringify({
        email: 'demo@example.com',
        goal: 'Add a note',
        out: 'reports/qa',
        model: 'google/gemini-2.5-flash',
        skipMobile: true,
        flows: ['landing', 'forms'],
        maxMinutes: 4,
        failOn: 'major',
        noAi: true,
        headed: true,
      }),
    );
    expect(loadConfig('example.test', {}, {}, readConfigFile(dir))).toEqual({
      url: 'https://example.test/',
      email: 'demo@example.com',
      goal: 'Add a note',
      out: 'reports/qa',
      model: 'google/gemini-2.5-flash',
      skipMobile: true,
      flows: ['landing', 'forms'],
      maxMinutes: 4,
      failOn: 'major',
      noAi: true,
      headed: true,
      yes: false,
    });
  });

  it('flows may also be written as one comma-separated text, like the flag', () => {
    write('{ "flows": "core, forms" }');
    expect(loadConfig('example.test', {}, {}, readConfigFile(dir)).flows).toEqual([
      'core',
      'forms',
    ]);
  });

  it('a flag wins over the environment, the environment over the file, the file over the default', () => {
    write(
      '{ "out": "from-file", "maxMinutes": 4, "failOn": "none", "email": "file@example.com", "flows": "core" }',
    );
    const file = readConfigFile(dir);
    // Nothing typed: the file fills in.
    expect(loadConfig('example.test', {}, {}, file)).toMatchObject({
      out: 'from-file',
      maxMinutes: 4,
      failOn: 'none',
      email: 'file@example.com',
      flows: ['core'],
      skipMobile: false, // not in the file: the default
    });
    // Environment beats the file.
    expect(loadConfig('example.test', {}, { SHIPCHECK_EMAIL: 'env@example.com' }, file).email).toBe(
      'env@example.com',
    );
    // Flags beat both.
    expect(
      loadConfig(
        'example.test',
        {
          out: 'typed',
          maxMinutes: '7',
          failOn: 'major',
          email: 'flag@example.com',
          flows: 'forms',
        },
        { SHIPCHECK_EMAIL: 'env@example.com' },
        file,
      ),
    ).toMatchObject({
      out: 'typed',
      maxMinutes: 7,
      failOn: 'major',
      email: 'flag@example.com',
      flows: ['forms'],
    });
  });

  it('refuses a password in the file and says where it belongs', () => {
    write('{ "email": "demo@example.com", "password": "CorrectHorse1!" }');
    expect(() => readConfigFile(dir)).toThrow(ConfigError);
    expect(() => readConfigFile(dir)).toThrow(/SHIPCHECK_PASSWORD/);
    // The message must not repeat the password.
    try {
      readConfigFile(dir);
    } catch (error) {
      expect((error as Error).message).not.toContain('CorrectHorse1!');
    }
  });

  it('refuses “yes” in the file: permission to test is confirmed each time, not stored', () => {
    write('{ "yes": true }');
    expect(() => readConfigFile(dir)).toThrow(/--yes/);
  });

  it('names a setting it does not know (a typo must not be ignored silently)', () => {
    write('{ "skipMobil": true }');
    expect(() => readConfigFile(dir)).toThrow(/“skipMobil”.*Known settings: .*skipMobile/);
  });

  it('explains broken JSON in plain words', () => {
    write('{ "out": "x", }');
    expect(() => readConfigFile(dir)).toThrow(/not valid JSON/);
  });

  it.each(['[]', '"text"', 'null'])(
    'refuses a file that is not a settings object: %s',
    (content) => {
      write(content);
      expect(() => readConfigFile(dir)).toThrow(/curly brackets/);
    },
  );

  it('names the setting with the wrong kind of value', () => {
    write('{ "skipMobile": "yes please" }');
    expect(() => readConfigFile(dir)).toThrow(/“skipMobile” has the wrong kind of value/);
  });

  it('values from the file get the same checks as flags', () => {
    write('{ "maxMinutes": 500 }');
    expect(() => loadConfig('example.test', {}, {}, readConfigFile(dir))).toThrow(/at most 60/);
    write('{ "flows": ["landing", "checkout"] }');
    expect(() => loadConfig('example.test', {}, {}, readConfigFile(dir))).toThrow(
      /Unknown flow “checkout”/,
    );
  });
});
