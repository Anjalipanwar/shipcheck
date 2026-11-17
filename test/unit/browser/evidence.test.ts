import { describe, expect, it } from 'vitest';
import { Evidence } from '../../../src/browser/evidence.js';

describe('Evidence: secrets hygiene (SPEC §7.6)', () => {
  it('scrubs protected values from every text', () => {
    const evidence = new Evidence();
    evidence.protect('hunter2-password');
    expect(evidence.redact('typed hunter2-password twice: hunter2-password')).toBe(
      'typed [hidden] twice: [hidden]',
    );
    expect(evidence.redact('nothing secret')).toBe('nothing secret');
  });

  it('ignores empty and very short values so normal words are not scrubbed', () => {
    const evidence = new Evidence();
    evidence.protect(undefined);
    evidence.protect('');
    evidence.protect('abc');
    expect(evidence.redact('abc and more')).toBe('abc and more');
  });

  it('scrubs the action log: value, intent, url and detail', () => {
    const evidence = new Evidence();
    evidence.protect('S3cret!pass');
    evidence.logAction({
      device: 'desktop',
      intent: 'Type the password S3cret!pass',
      action: 'fill',
      locator: '#password',
      value: 'S3cret!pass',
      url: 'https://example.com/login?pw=S3cret!pass',
      result: 'ok',
      detail: 'typed S3cret!pass',
    });
    expect(JSON.stringify(evidence.actionLog)).not.toContain('S3cret!pass');
    expect(evidence.actionLog[0]).toMatchObject({
      step: 1,
      value: '[hidden]',
      locator: '#password',
      result: 'ok',
    });
  });

  it('scrubs and shortens recorded events', () => {
    const evidence = new Evidence();
    evidence.protect('S3cret!pass');
    evidence.recordBlockedNavigation(
      'desktop',
      'https://example.com/',
      `https://other.test/?p=S3cret!pass&x=${'y'.repeat(2000)}`,
    );
    const [event] = evidence.events;
    expect(JSON.stringify(event)).not.toContain('S3cret!pass');
    expect(event?.kind === 'blocked-navigation' && event.url.length).toBeLessThan(600);
  });
});

describe('Evidence: action log', () => {
  it('numbers steps and attaches the current flow', () => {
    const evidence = new Evidence();
    evidence.logAction({
      device: 'desktop',
      intent: 'a',
      action: 'goto',
      url: 'https://example.com/',
      result: 'ok',
    });
    evidence.setScope('login');
    evidence.logAction({
      device: 'mobile',
      intent: 'b',
      action: 'click',
      url: 'https://example.com/',
      result: 'blocked',
    });
    evidence.setScope(undefined);
    evidence.logAction({
      device: 'desktop',
      intent: 'c',
      action: 'click',
      url: 'https://example.com/',
      result: 'failed',
      flow: 'core',
    });
    expect(evidence.actionLog.map((a) => [a.step, a.flow, a.result])).toEqual([
      [1, undefined, 'ok'],
      [2, 'login', 'blocked'],
      [3, 'core', 'failed'],
    ]);
    expect(evidence.actionLog[0]).not.toHaveProperty('value');
  });
});

describe('Evidence: a protected value in every spelling (audit A-02)', () => {
  const PASSWORD = 'P@ss w0rd!';
  const evidence = new Evidence();
  evidence.protect(PASSWORD);

  it.each([
    [
      'in a web address, form-encoded',
      `https://app.test/login?email=a%40b.c&x=${new URLSearchParams({ v: PASSWORD }).toString().slice(2)}`,
    ],
    ['in a web address, encoded', `https://app.test/#${encodeURIComponent(PASSWORD)}`],
    ['inside JSON', JSON.stringify({ secret: `${PASSWORD} "quoted"` })],
    ['HTML-escaped', 'value=&quot;P@ss w0rd!&quot;'],
  ])('%s', (_name, text) => {
    const out = evidence.redact(text);
    expect(out).toContain('[hidden]');
    expect(out).not.toContain('w0rd');
  });

  it('JSON-escaped and HTML-escaped spellings of a password with quotes are hidden', () => {
    const quoted = new Evidence();
    quoted.protect('pa"ss\\word<1>');
    expect(quoted.redact(JSON.stringify({ p: 'pa"ss\\word<1>' }))).toBe('{"p":"[hidden]"}');
    expect(quoted.redact('pa&quot;ss\\word&lt;1&gt;')).toBe('[hidden]');
  });

  it('hides the value of password-like parameters in any web address, whatever was typed', () => {
    const plain = new Evidence(); // nothing protected
    expect(plain.redact('https://a.app/login?email=x%40y.z&password=ab&next=/')).toBe(
      'https://a.app/login?email=x%40y.z&password=[hidden]&next=/',
    );
    expect(plain.redact('GET /signup?user_password=Sc-1!9a&pwd=x;pin=1234')).toBe(
      'GET /signup?user_password=[hidden]&pwd=[hidden];pin=[hidden]',
    );
    // Ordinary words and parameters stay as they are.
    expect(plain.redact('/passage?compass=north&spin=2 password reset')).toBe(
      '/passage?compass=north&spin=2 password reset',
    );
  });
});
