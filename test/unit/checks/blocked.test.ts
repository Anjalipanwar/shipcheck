import { describe, expect, it } from 'vitest';
import type { EvidenceEvent } from '../../../src/browser/evidence.js';
import {
  causedByShipCheck,
  describeBlocking,
  separateShipCheckBlocking,
} from '../../../src/checks/blocked.js';
import { checkErrors } from '../../../src/checks/errors.js';

const PAGE = 'https://app.example.com/';
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 14, 12, 0, seconds)).toISOString();
const base = (seconds: number, pageUrl = PAGE) => ({
  at: at(seconds),
  device: 'desktop' as const,
  pageUrl,
});

const blockedPayment = (
  seconds: number,
  url = 'https://api.stripe.com/v1/tokens',
): EvidenceEvent => ({
  ...base(seconds),
  kind: 'blocked-request',
  url,
  method: 'POST',
  reason: 'a request to a payment provider',
  cause: 'payment-host',
  topLevel: false,
});
const failed = (url: string, blockedBy?: 'shipcheck'): EvidenceEvent => ({
  ...base(1),
  kind: 'request-failed',
  url,
  method: 'POST',
  resourceType: 'fetch',
  text: 'net::ERR_BLOCKED_BY_CLIENT',
  ...(blockedBy ? { blockedBy } : {}),
});
const consoleError = (seconds: number, text: string, pageUrl = PAGE): EvidenceEvent => ({
  ...base(seconds, pageUrl),
  kind: 'console-error',
  text,
});
const crash = (seconds: number, text: string): EvidenceEvent => ({
  ...base(seconds),
  kind: 'page-error',
  text,
});

describe('separateShipCheckBlocking', () => {
  it('a request ShipCheck blocked is ours; a request that failed by itself is the app’s', () => {
    const ours = failed('https://api.stripe.com/v1/tokens', 'shipcheck');
    const app = { ...failed('https://app.example.com/api/notes'), text: 'net::ERR_FAILED' };
    const events = [blockedPayment(0), ours, app];
    expect(separateShipCheckBlocking(events).ours).toEqual([ours]);
    expect(causedByShipCheck(app, events)).toBe(false);
  });

  it('an error naming the blocked server is ours, however late it appears', () => {
    const events = [
      blockedPayment(0),
      consoleError(50, 'PayWidget: could not reach api.stripe.com'),
    ];
    expect(separateShipCheckBlocking(events).ours).toHaveLength(1);
  });

  it('"Failed to fetch" right after a block on the same page is ours', () => {
    const events = [blockedPayment(0), crash(1, 'TypeError: Failed to fetch')];
    expect(separateShipCheckBlocking(events).ours).toHaveLength(1);
  });

  it('"Failed to fetch" long after the block, or on another page, stays an app problem', () => {
    const late = crash(30, 'TypeError: Failed to fetch');
    const elsewhere = consoleError(1, 'Failed to fetch', 'https://app.example.com/other');
    const separated = separateShipCheckBlocking([blockedPayment(0), late, elsewhere]);
    expect(separated.ours).toEqual([]);
    expect(separated.app).toContain(late);
    expect(separated.app).toContain(elsewhere);
  });

  it('a real crash at the same moment as a block is still the app’s', () => {
    const real = crash(1, "TypeError: Cannot read properties of undefined (reading 'name')");
    expect(separateShipCheckBlocking([blockedPayment(0), real]).app).toContain(real);
  });

  it('the provider’s name counts only for payment blocks and only right after one', () => {
    const named = consoleError(1, 'Stripe.js could not initialise');
    expect(separateShipCheckBlocking([blockedPayment(0), named]).ours).toEqual([named]);
    expect(separateShipCheckBlocking([named]).ours).toEqual([]);
  });

  it('without any block, nothing is ours', () => {
    const events = [crash(1, 'TypeError: Failed to fetch'), consoleError(2, 'boom')];
    expect(separateShipCheckBlocking(events).ours).toEqual([]);
  });
});

describe('checkErrors on separated events — no false findings from blocking', () => {
  it('payment script fails because of the block → no error finding', () => {
    const events = [
      blockedPayment(0),
      failed('https://api.stripe.com/v1/tokens', 'shipcheck'),
      { ...failed('https://r.stripe.com/b', 'shipcheck'), text: 'net::ERR_FAILED' },
      consoleError(1, 'PayWidget: could not reach r.stripe.com — Failed to fetch'),
      crash(1, 'TypeError: Failed to fetch'),
    ];
    const result = checkErrors(separateShipCheckBlocking(events).app);
    expect(result.findings).toEqual([]);
  });

  it('a real crash in the same run is still reported', () => {
    const events = [blockedPayment(0), crash(1, 'ReferenceError: trackSignup is not defined')];
    const result = checkErrors(separateShipCheckBlocking(events).app);
    expect(result.findings.map((f) => f.rule)).toEqual(['errors/uncaught-exception']);
  });
});

describe('describeBlocking', () => {
  it('lists each kind of block once, in plain words', () => {
    const events: EvidenceEvent[] = [
      blockedPayment(0),
      blockedPayment(1, 'https://js.stripe.com/v3/controller.html'),
      {
        ...base(2),
        kind: 'blocked-request',
        url: 'https://app.example.com/api/delete-account',
        method: 'POST',
        reason: 'x',
        cause: 'destructive-request',
        topLevel: false,
      },
      { ...base(3), kind: 'blocked-navigation', url: 'https://twitter.com/notenest' },
    ];
    expect(describeBlocking(events, 3)).toEqual([
      'Payment requests were blocked by design (to api.stripe.com, js.stripe.com), so paying was not tested',
      'Requests that could delete data, cancel something or start a payment were blocked by design (POST /api/delete-account)',
      'Pages on other websites (twitter.com) — ShipCheck only tests the app you asked for',
      '3 error messages and failed requests were caused by this blocking and are not counted as problems in your app',
    ]);
  });

  it('nothing blocked → nothing listed', () => {
    expect(describeBlocking([], 0)).toEqual([]);
  });
});
