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
