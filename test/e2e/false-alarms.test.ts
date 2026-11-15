import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { Report } from '../../src/report/schema.js';
import { runShipCheck } from '../../src/runner.js';
import type { Page } from 'playwright';
import type { ProposedAction } from '../../src/browser/guard.js';
import {
  DEMO_ACCOUNT,
  startFixtureServer,
  type FixtureOptions,
} from '../helpers/fixture-server.js';
import { createScriptedDriver, type ScriptedOptions } from '../helpers/scripted-driver.js';

/**
 * False alarms seen in the run on a real app (owner decision 2026-11-15, lessons 1 and 2 in
 * docs/PROGRESS.md), reproduced on two fixture pages that work correctly:
 *  - /late-signup.html: the account is created, but the page shows a loading label for a few
 *    seconds before it moves on to the dashboard;
 *  - /tracked-form.html: the page refuses bad input itself, while a tracking beacon (a same-site
 *    POST answered 202) fires on every click.
 * Neither page has a bug, so neither may produce a finding.
 */
const problems = (report: Report, prefix: string) =>
  report.findings.filter((f) => f.rule.startsWith(prefix) && f.severity !== 'info');

const run = async (
  path: string,
  flows: string,
  server: FixtureOptions = {},
  driver: ScriptedOptions = {},
  flags: Record<string, string | boolean> = {},
) => {
  const app = await startFixtureServer(server);
  try {
    const result = await runShipCheck(
      loadConfig(`${app.url}${path}`, { yes: true, flows, skipMobile: true, ...flags }, {}),
      {},
      { aiDriver: (budget) => createScriptedDriver({ budget, ...driver }) },
    );
    return { report: result.report, hits: { ...app.hits } };
  } finally {
    await app.close();
  }
};

describe('false alarms from the real-app run', () => {
  it('a sign-up that works but redirects late is reported as working, not as “cannot sign up”', async () => {
    const { report, hits } = await run('/late-signup.html', 'signup');
    expect(hits.signup).toBe(1); // the account really was created
    expect(problems(report, 'signup/').map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(report.passed.join('\n')).toMatch(/sign(ing)? ?up/i);
    expect(report.coverage.find((e) => e.area === 'signup')?.state).toBe('no-problems');
  });

  it('control: a sign-up the server really refuses is still a Blocker, with the app’s message', async () => {
    const { report } = await run('/late-signup.html', 'signup', { rejectAllSignups: true });
    const found = problems(report, 'signup/');
    expect(found.map((f) => `${f.severity}: ${f.title}`)).toEqual([
      'blocker: New users cannot sign up',
    ]);
    expect(found[0]?.whatHappened).toContain('Something went wrong');
  });

  it('a log-in that answers slowly: the wrong password’s message and the successful log-in are both seen', async () => {
    const { report } = await run('/slow-login.html', 'login', {}, {}, DEMO_ACCOUNT);
    expect(problems(report, 'login/').map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'A wrong password shows a clear message',
        'Logging in with the correct password works',
      ]),
    );
    expect(report.coverage.find((e) => e.area === 'login')?.state).toBe('no-problems');
  });

  it('control: a slow log-in the server really refuses is still a Blocker, with the app’s message', async () => {
    const { report } = await run(
      '/slow-login.html',
      'login',
      { rejectAllLogins: true },
      {},
      DEMO_ACCOUNT,
    );
    const found = problems(report, 'login/');
    expect(found.map((f) => `${f.severity}: ${f.title}`)).toEqual(['blocker: Users cannot log in']);
    expect(found[0]?.whatHappened).toContain('Invalid login credentials');
  });

  it('an app that changes the address first and shows the screen later is seen as logged in', async () => {
    const { report } = await run('/slow-login.html?lazy=1', 'login', {}, {}, DEMO_ACCOUNT);
    expect(problems(report, 'login/').map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Logging in with the correct password works',
        'Users stay logged in after refreshing the page',
      ]),
    );
    expect(report.coverage.find((e) => e.area === 'login')?.state).toBe('no-problems');
  });

  it('a message left over from the wrong password is not proof that the right one failed', async () => {
    // The server accepts the log-in and the app opens in place (same address), but the old
    // "Invalid login credentials" still stands on the page. Not a Blocker: "Not tested".
    const { report } = await run('/slow-login.html?inplace=1', 'login', {}, {}, DEMO_ACCOUNT);
    expect(problems(report, 'login/').map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(report.passed).toContain('A wrong password shows a clear message');
    const row = report.coverage.find((e) => e.area === 'login');
    expect(row?.state).toBe('not-tested');
    expect(row?.note).toMatch(/could not confirm/);
  });

  it('a model that says “logged in” after every attempt is overruled by the server’s refusal', async () => {
    const { report } = await run(
      '/slow-login.html',
      'login',
      { rejectAllLogins: true },
      { gullibleLogin: true },
      DEMO_ACCOUNT,
    );
    expect(report.findings.map((f) => f.rule)).not.toContain('login/accepts-wrong-password');
    expect(report.passed).toContain('A wrong password shows a clear message');
    expect(report.passed).not.toContain('Logging in with the correct password works');
    expect(problems(report, 'login/').map((f) => `${f.severity}: ${f.title}`)).toEqual([
      'blocker: Users cannot log in',
    ]);
  });

  it('on a phone, log-in and sign-up links behind the menu button are found by opening the menu', async () => {
    const { report } = await run('/menu-ok.html', 'signup,login', {}, {}, { skipMobile: false });
    expect(
      report.notTested.filter((line) => / on a phone — no (log-in|sign-up) form/.test(line)),
    ).toEqual([]);
    // Both forms were reached on the phone: the sign-up form was filled in (its planted phone
    // bug is found), and the log-in went through to the dashboard.
    const phone = report.actionLog.filter((a) => a.device === 'mobile');
    const paths = (flow: string) =>
      phone.filter((a) => a.flow === flow).map((a) => new URL(a.url).pathname);
    expect(paths('signup')).toContain('/signup.html');
    expect(paths('login')).toEqual(expect.arrayContaining(['/login.html', '/dashboard.html']));
    expect(report.findings.map((f) => f.rule)).toContain('signup/button-does-nothing');
    expect(report.passed).toContain('Users stay logged in after refreshing the page on a phone');
    const menuTaps = report.actionLog.filter(
      (a) =>
        a.device === 'mobile' &&
        ['signup', 'login'].includes(a.flow ?? '') &&
        /phone menu/.test(a.intent ?? ''),
    );
    expect(menuTaps.map((a) => a.result)).toEqual(['ok', 'ok']);
  });

  it('a tracking beacon is not “the server accepted the form”: a form that refuses bad input has no finding', async () => {
    const { report, hits } = await run('/tracked-form.html', 'forms');
    expect(hits.track).toBeGreaterThan(0); // the beacon did fire
    // The page's menu links to /contact.html, which has planted bugs; only this page counts here.
    const here = problems(report, 'forms/').filter((f) =>
      (f.evidence.url ?? '').endsWith('/tracked-form.html'),
    );
    expect(here.map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(report.passed).toContain('An empty form is not accepted (/tracked-form.html)');
    expect(hits.contact).toBeGreaterThan(0); // control: the buggy contact page was still caught
    expect(problems(report, 'forms/').length).toBeGreaterThan(0);
  });

  it('the main-feature flow never signs up by itself: a sign-up wall is “Not tested”, not a Blocker', async () => {
    // Like the real model did: not logged in, it heads for the sign-up form and makes up details.
    const wanders = (page: Page, done: number): ProposedAction[] => {
      const at = new URL(page.url()).pathname;
      const step = (selector: string, description: string, value?: string): ProposedAction[] => [
        {
          selector,
          description,
          method: value === undefined ? 'click' : 'fill',
          arguments: value === undefined ? [] : [value],
        },
      ];
      if (at !== '/signup.html') {
        return step('xpath=//header//nav//a[@href="/signup.html"]', 'Sign up link');
      }
      if (done === 1)
        return step('xpath=//*[@id="signup-email"]', 'Email field', 'user@example.com');
      if (done === 2) return step('xpath=//*[@id="signup-password"]', 'Password field', 'pass123');
      return done === 3 ? step('xpath=//*[@id="signup-button"]', 'Create account button') : [];
    };
    const { report, hits } = await run('/', 'core', {}, { nextStep: wanders, goal: 'Add a note' });
    expect(problems(report, 'core/').map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(hits.signup).toBe(0); // no account made with invented details
    expect(
      report.actionLog.filter((a) => a.action === 'fill' && /password/.test(a.locator ?? '')),
    ).toEqual([]);
    const core = report.coverage.find((e) => e.area === 'core');
    expect(core?.state).toBe('not-tested');
    expect(core?.note).toMatch(/Add a test account \(see the README\)\.$/);
  });
});
