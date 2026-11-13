import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, normalizeUrl } from '../../src/config.js';

describe('normalizeUrl', () => {
  it('adds https:// when the scheme is missing', () => {
    expect(normalizeUrl('myapp.lovable.app')).toBe('https://myapp.lovable.app/');
    expect(normalizeUrl('  example.com/start  ')).toBe('https://example.com/start');
  });
  it('uses http:// for local addresses without a scheme', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeUrl('127.0.0.1:5173/app')).toBe('http://127.0.0.1:5173/app');
  });
  it('keeps a given scheme and drops the #fragment', () => {
    expect(normalizeUrl('http://example.com/a?b=1#top')).toBe('http://example.com/a?b=1');
  });
  it.each([
    '',
    '   ',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'nonsense',
    'http://',
  ])('rejects %j with a friendly message', (input) => {
    expect(() => normalizeUrl(input)).toThrow(ConfigError);
  });
  it('rejects passwords inside the address', () => {
    expect(() => normalizeUrl('https://me:secret@example.com')).toThrow(/username or password/);
  });
});

describe('loadConfig', () => {
  it('applies the defaults from SPEC §5.1', () => {
    expect(loadConfig('example.com', {}, {})).toEqual({
      url: 'https://example.com/',
      out: './shipcheck-report',
      noAi: false,
      headed: false,
      yes: false,
      skipMobile: false,
      maxMinutes: 10,
      failOn: 'blocker',
      flows: ['landing', 'signup', 'login', 'core', 'forms'],
    });
  });

  it('reads flags as commander delivers them', () => {
    const config = loadConfig(
      'example.com',
      {
        ai: false,
        yes: true,
        headed: true,
        skipMobile: true,
        maxMinutes: '3',
        failOn: 'major',
        flows: 'login, Landing,login',
        out: 'x',
      },
      {},
    );
    expect(config).toMatchObject({
      noAi: true,
      yes: true,
      headed: true,
      skipMobile: true,
      maxMinutes: 3,
      failOn: 'major',
      flows: ['login', 'landing'],
      out: 'x',
    });
  });

  it('takes credentials from the environment, and flags win over the environment', () => {
    const env = { SHIPCHECK_EMAIL: 'env@example.com', SHIPCHECK_PASSWORD: 'env-pass' };
    expect(loadConfig('example.com', {}, env)).toMatchObject({
      email: 'env@example.com',
      password: 'env-pass',
    });
    expect(loadConfig('example.com', { email: 'flag@example.com' }, env)).toMatchObject({
      email: 'flag@example.com',
      password: 'env-pass',
    });
  });

  it.each([
    [{ maxMinutes: 'abc' }, /max-minutes/],
    [{ maxMinutes: '0' }, /at least 1/],
    [{ maxMinutes: '999' }, /at most 60/],
    [{ maxMinutes: '2.5' }, /whole number/],
    [{ flows: 'login,dance' }, /Unknown flow “dance”/],
    [{ failOn: 'everything' }, /./],
  ])('rejects %j', (flags, message) => {
    expect(() => loadConfig('example.com', flags, {})).toThrow(ConfigError);
    expect(() => loadConfig('example.com', flags, {})).toThrow(message);
  });
});
