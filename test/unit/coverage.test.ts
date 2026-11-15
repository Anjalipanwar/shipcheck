import { describe, expect, it } from 'vitest';
import {
  CoverageRecorder,
  combine,
  flowOutcome,
  phoneOutcome,
  reasonOf,
  withAdvice,
} from '../../src/coverage.js';
import type { FlowResult } from '../../src/flows/types.js';
import { areasOf } from '../../src/report/areas.js';
import { ADVICE } from '../../src/report/present.js';
import { makeFinding, type FindingInput } from '../../src/report/schema.js';

const flow = (overrides: Partial<FlowResult> = {}): FlowResult => ({
  name: 'login',
  status: 'completed',
  observations: [],
  notTested: [],
  gaps: [],
  steps: 3,
  ...overrides,
});

const finding = (overrides: Partial<FindingInput> = {}) =>
  makeFinding({
    rule: 'test/rule',
    title: 'Something is wrong',
    severity: 'minor',
    category: 'functional',
    device: 'desktop',
    whatHappened: 'It broke.',
    whyItMatters: 'People notice.',
    stepsToReproduce: [],
    evidence: { screenshots: [], logs: ['a log line'] },
    confidence: 'verified',
    ...overrides,
  });

describe('reasonOf / withAdvice', () => {
  it('keeps the reason after the dash, first sentence only', () => {
    expect(
      reasonOf(
        'Signing up — no sign-up form with a password was found. If the app only offers “Sign in with Google”…',
      ),
    ).toBe('no sign-up form with a password was found');
    expect(reasonOf('plain line.')).toBe('plain line');
  });
  it('a reason always ends with what the user can do', () => {
    expect(withAdvice('your AI key’s quota ran out.', ADVICE.quota)).toBe(
      'your AI key’s quota ran out. Try again tomorrow, or use a paid key.',
    );
  });
});

describe('flowOutcome', () => {
  it('finished with nothing in the way → tested (also when it found a bug)', () => {
    expect(flowOutcome(flow())).toEqual({ state: 'tested' });
  });
  it('something blocked it (email confirmation, CAPTCHA, no account) → not tested, with reason and next step', () => {
    expect(
      flowOutcome(
        flow({
          gaps: [
            {
              kind: 'blocked',
              reason: 'the app asks new users to confirm their email',
              action: ADVICE.account,
            },
          ],
        }),
      ),
    ).toEqual({
      state: 'not-tested',
      note: 'the app asks new users to confirm their email. Add a test account (see the README).',
    });
  });
  it('a blocked reason without its own next step still gets one', () => {
    expect(flowOutcome(flow({ gaps: [{ kind: 'blocked', reason: 'x' }] })).note).toBe(
      'x. Check this part by hand.',
    );
  });
  it('the user’s choice (a test account was given) → skipped; no such part in the app → absent', () => {
    expect(
      flowOutcome(flow({ gaps: [{ kind: 'choice', reason: 'you gave a test account' }] })),
    ).toEqual({ state: 'skipped', note: 'you gave a test account' });
    expect(
      flowOutcome(flow({ gaps: [{ kind: 'absent', reason: 'no sign-up page was found' }] })),
    ).toEqual({ state: 'absent', note: 'no sign-up page was found' });
  });
  it('stopped before a payment (by design) → its own neutral outcome, not "not tested"', () => {
    expect(
      flowOutcome(
        flow({ status: 'stopped', gaps: [{ kind: 'payment', reason: 'stopped before payment' }] }),
      ),
    ).toEqual({ state: 'payment-stop' });
    expect(combine([{ state: 'tested' }, { state: 'payment-stop' }]).state).toBe('payment-stop');
    expect(combine([{ state: 'payment-stop' }, { state: 'not-tested' }]).state).toBe('not-tested');
  });
  it('blocked wins over choice and absent; a crash is not tested', () => {
    expect(
      flowOutcome(
        flow({
          gaps: [
            { kind: 'choice', reason: 'c' },
            { kind: 'blocked', reason: 'b', action: ADVICE.quota },
          ],
        }),
      ).state,
    ).toBe('not-tested');
    expect(flowOutcome(flow({ status: 'failed' }))).toEqual({
      state: 'not-tested',
      note: 'this part could not finish. Try again; if it keeps happening, please report it.',
    });
  });
});

describe('phoneOutcome', () => {
  it('names the blocked flows; flows that share a reason are named together', () => {
    expect(phoneOutcome([{ label: 'Sign-up', state: 'tested' }])).toEqual({ state: 'tested' });
    expect(
      phoneOutcome([
        { label: 'Landing page', state: 'not-tested', note: 'limit reached. Run again.' },
        { label: 'Sign-up', state: 'not-tested', note: 'limit reached. Run again.' },
        { label: 'Log-in', state: 'tested' },
      ]),
    ).toEqual({ state: 'not-tested', note: 'Landing page, Sign-up: limit reached. Run again.' });
  });
  it('a flow skipped by choice or missing from the app does not make the row "not tested"', () => {
    expect(
      phoneOutcome([
        { label: 'Sign-up', state: 'skipped', note: 'you gave a test account' },
        { label: 'Log-in', state: 'tested' },
      ]),
    ).toEqual({ state: 'tested', note: undefined });
  });
});

describe('combine', () => {
  it('blocked beats tested beats skipped beats absent', () => {
    expect(combine([{ state: 'tested' }, { state: 'not-tested', note: 'n' }]).state).toBe(
      'not-tested',
    );
    expect(combine([{ state: 'skipped' }, { state: 'tested' }]).state).toBe('tested');
    expect(combine([{ state: 'absent' }, { state: 'skipped' }]).state).toBe('skipped');
    expect(combine([{ state: 'absent' }]).state).toBe('absent');
  });
});

describe('areasOf', () => {
  it('puts each finding in the row a reader would look in', () => {
    expect(areasOf(finding({ flow: 'login' }))).toEqual(['login']);
    expect(areasOf(finding({ flow: 'signup', device: 'mobile' }))).toEqual(['phone-flows']);
    expect(areasOf(finding({ flow: 'core', device: 'both' })).sort()).toEqual([
      'core',
      'phone-flows',
    ]);
    expect(
      areasOf(finding({ rule: 'mobile/sideways-scroll', flow: 'mobile', device: 'mobile' })),
    ).toEqual(['phone-layout']);
    // Found while using the app on a phone (the runner tags these with the flow "mobile").
    expect(
      areasOf(finding({ rule: 'signup/button-does-nothing', flow: 'mobile', device: 'mobile' })),
    ).toEqual(['phone-flows']);
    expect(areasOf(finding({ rule: 'performance/slow-landing', category: 'performance' }))).toEqual(
      [],
    );
    expect(areasOf(finding({ rule: 'links/broken', category: 'functional' }))).toEqual(['links']);
    expect(areasOf(finding({ category: 'seo' }))).toEqual(['seo']);
    expect(areasOf(finding({ category: 'security', severity: 'info' }))).toEqual([]);
  });
});

describe('CoverageRecorder', () => {
  it('counts the problems of each area and names the worst; info findings are not problems', () => {
    const recorder = new CoverageRecorder();
    for (const area of ['security', 'seo', 'login'] as const)
      recorder.mark(area, { state: 'tested' });
    const built = recorder.build(
      [
        finding({ category: 'security', severity: 'blocker' }),
        finding({ category: 'security', severity: 'minor', title: 'b' }),
        finding({ category: 'seo', severity: 'info' }),
      ],
      () => ({ state: 'not-tested', note: 'fallback' }),
    );
    expect(built.find((e) => e.area === 'security')).toEqual({
      area: 'security',
      state: 'problems',
      problems: 2,
      worst: 'blocker',
    });
    expect(built.find((e) => e.area === 'seo')).toEqual({ area: 'seo', state: 'no-problems' });
    expect(built.find((e) => e.area === 'core')).toEqual({
      area: 'core',
      state: 'not-tested',
      note: 'fallback',
    });
    expect(built).toHaveLength(11);
  });
  it('one blocked check of a multi-check area makes the area not tested', () => {
    const recorder = new CoverageRecorder();
    recorder.mark('security', { state: 'tested' });
    recorder.mark('security', {
      state: 'not-tested',
      note: 'Security settings: could not finish.',
    });
    expect(
      recorder.build([], () => ({ state: 'tested' })).find((e) => e.area === 'security'),
    ).toEqual({
      area: 'security',
      state: 'not-tested',
      note: 'Security settings: could not finish.',
    });
  });
  it('problems in an area that was also blocked: the problems show, and it still counts as untested', () => {
    const recorder = new CoverageRecorder();
    recorder.mark('login', { state: 'not-tested', note: 'no test account. Add one.' });
    expect(
      recorder
        .build([finding({ flow: 'login', severity: 'major' })], () => ({ state: 'tested' }))
        .find((e) => e.area === 'login'),
    ).toEqual({
      area: 'login',
      state: 'problems',
      problems: 1,
      worst: 'major',
      note: 'no test account. Add one.',
      partial: true,
    });
  });
  it('failAll overrides everything marked before', () => {
    const recorder = new CoverageRecorder();
    recorder.mark('errors', { state: 'tested' });
    recorder.failAll('the home page did not load. Fix that first.');
    expect(
      recorder
        .build([], () => ({ state: 'tested' }))
        .every((e) => e.state === 'not-tested' && e.note?.startsWith('the home page')),
    ).toBe(true);
  });
});
