import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { Report } from '../../src/report/schema.js';
import { runShipCheck } from '../../src/runner.js';
import type { Page } from 'playwright';
import type { ProposedAction } from '../../src/browser/guard.js';
import { startFixtureServer, type FixtureOptions } from '../helpers/fixture-server.js';
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
) => {
  const app = await startFixtureServer(server);
  try {
    const result = await runShipCheck(
      loadConfig(`${app.url}${path}`, { yes: true, flows, skipMobile: true }, {}),
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
