import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProposedAction } from '../../src/browser/guard.js';
import { loadConfig } from '../../src/config.js';
import { ReportSchema, type Report } from '../../src/report/schema.js';
import { runShipCheck, type RunResult } from '../../src/runner.js';
import { createScriptedDriver } from '../helpers/scripted-driver.js';
import { DEMO_ACCOUNT, startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * Full runs against the buggy fixture app with a scripted stand-in for the AI (no key needed).
 * The flows, the guard, the backstop, the budget and the report are all the real thing.
 */
const TRAPS_UNTOUCHED = { deleteAccount: 0, checkoutSubmit: 0, cardDataReceived: 0 };
const rules = (report: Report) => report.findings.map((f) => f.rule);
const clickAt = (selector: string, description: string): ProposedAction => ({
  selector,
  description,
  method: 'click',
  arguments: [],
});

describe('full run with all five flows', () => {
  let app: FixtureServer;
  let result: RunResult;
  let report: Report;
  const progress: string[] = [];

  beforeAll(async () => {
    app = await startFixtureServer();
    result = await runShipCheck(
      loadConfig(app.url, { yes: true }, {}),
      { progress: (line) => progress.push(line) },
      { aiDriver: (budget) => createScriptedDriver({ budget }) },
    );
    report = ReportSchema.parse(result.report);
  });
  afterAll(async () => {
    await app.close();
  });

  it('finds planted bug #7: no message on a wrong password', () => {
    const finding = report.findings.find((f) => f.rule === 'login/no-error-on-wrong-password');
    expect(finding).toMatchObject({
      severity: 'major',
      flow: 'login',
      title: 'Login shows no message when the password is wrong',
      confidence: 'verified',
    });
    // Seen on the desktop and again on the phone: one finding for both, with both pictures.
    expect(finding?.device).toBe('both');
    expect(finding?.evidence.screenshots).toEqual([
      expect.stringMatching(/-desktop-login-wrong-password-no-message\.jpg$/),
      expect.stringMatching(/-mobile-login-wrong-password-no-message\.jpg$/),
    ]);
    expect(finding?.evidence.logs?.join(' ')).toMatch(/status 401/);
    expect(finding?.evidence.logs).toContain('The same happens on a phone (iPhone, 390×844)');
    expect(
      report.findings.filter((f) => f.rule === 'login/no-error-on-wrong-password'),
    ).toHaveLength(1);
    expect(app.hits.loginFailed).toBe(2); // once per device
  });

  it('finds planted bug #1 on the phone only: the sign-up button does nothing (Blocker)', () => {
    const found = report.findings.filter((f) => f.rule === 'signup/button-does-nothing');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      title: 'The sign-up button does nothing on a phone',
      severity: 'blocker',
      category: 'mobile',
      flow: 'mobile',
      device: 'mobile',
      confidence: 'verified',
    });
    expect(found[0]?.whatHappened).toMatch(
      /^On a phone-sized screen \(iPhone, 390×844\): .* On a desktop screen the same steps work\./,
    );
    expect(found[0]?.evidence.screenshots).toEqual([
      expect.stringMatching(/-mobile-signup-nothing-happened\.jpg$/),
    ]);
    // Desktop sign-up works and is reported as working; the phone attempt never reached the server.
    expect(report.passed).toContain('Signing up with an email address and password works');
    expect(report.passed).not.toContain(
      'Signing up with an email address and password works on a phone',
    );
    expect(app.hits.signup).toBe(1);
  });

  it('finds planted bug #8 on the phone only, and no layout finding for the desktop', () => {
    const sideways = report.findings.filter((f) => f.rule === 'mobile/sideways-scroll');
    expect(sideways.map((f) => [f.device, f.severity, f.evidence.url])).toEqual([
      ['mobile', 'minor', `${app.url}/features.html`],
    ]);
    expect(report.findings.filter((f) => f.category === 'mobile' && f.device !== 'mobile')).toEqual(
      [],
    );
  });

  it('the phone pass repeats landing, sign-up, login and the main feature', () => {
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Logging in with the correct password works on a phone',
        'The main feature works: Add a note on a phone',
        'What you enter is still there after refreshing the page on a phone',
      ]),
    );
    const phoneFlows = new Set(
      report.actionLog.filter((a) => a.device === 'mobile').map((a) => a.flow),
    );
    expect([...phoneFlows].sort()).toEqual(['core', 'landing', 'login', 'mobile', 'signup']);
  });

  it('finds planted bug #2: the contact form accepts empty and invalid input', () => {
    expect(report.findings.find((f) => f.rule === 'forms/accepts-empty')).toMatchObject({
      severity: 'major',
      flow: 'forms',
    });
    const invalid = report.findings.find((f) => f.rule === 'forms/accepts-invalid');
    expect(invalid?.title).toBe(
      'A form accepts an invalid email address and a 5,000-character name',
    );
    expect(invalid?.evidence.logs?.[0]).toMatch(/POST .*\/api\/contact → 200/);
    expect(app.contactSubmissions[0]).toEqual({ name: '', email: '', message: '' });
    expect(app.contactSubmissions[1]).toMatchObject({ email: 'not-an-email' });
    expect(app.contactSubmissions[1]?.name).toHaveLength(5000);
  });

  it('finds planted bug #11: a double click sends the contact form twice (Minor)', () => {
    const finding = report.findings.find((f) => f.rule === 'forms/duplicate-submit');
    expect(finding).toMatchObject({
      severity: 'minor',
      flow: 'forms',
      title: 'Clicking a form’s button twice sends it twice',
      confidence: 'verified',
    });
    expect(finding?.evidence.url).toBe(`${app.url}/contact.html`);
    expect(finding?.evidence.logs).toHaveLength(2);
    // empty + bad input + the double click (2) = 4 accepted submissions
    expect(app.hits.contact).toBe(4);
  });

  it('opposite case: the newsletter form is sent once and gets no form finding at all', () => {
    // It was really double-clicked with a valid address…
    const double = report.actionLog.filter(
      (a) => a.action === 'doubleClick' && a.locator === 'xpath=//*[@id="newsletter-button"]',
    );
    expect(double.map((a) => a.result)).toEqual(['ok']);
    // …the server got exactly one sign-up (the empty and the invalid attempt were refused)…
    expect(app.hits.newsletter).toBe(1);
    // …and nothing is reported against the home page's form.
    const formFindings = report.findings.filter((f) => f.rule.startsWith('forms/'));
    expect(formFindings.map((f) => f.evidence.url)).toEqual([
      `${app.url}/contact.html`,
      `${app.url}/contact.html`,
      `${app.url}/contact.html`,
    ]);
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'An empty form is not accepted (/)',
        'Bad input is handled without errors (/)',
        'A double click sends the form only once (/)',
      ]),
    );
  });

  it('reports what works as working — no false alarms from the flows', () => {
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Signing up with an email address and password works',
        'Logging in with the correct password works',
        'Users stay logged in after refreshing the page',
        'The main feature works: Add a note',
        'What you enter is still there after refreshing the page',
      ]),
    );
    expect(
      report.findings
        .filter((f) => f.device !== 'mobile')
        .map((f) => f.rule)
        .filter((rule) => /^(landing|signup|login|core|forms)\//.test(rule))
        .sort(),
    ).toEqual([
      'forms/accepts-empty',
      'forms/accepts-invalid',
      'forms/duplicate-submit',
      'login/no-error-on-wrong-password',
    ]);
    // The 401 that ShipCheck provoked with a wrong password is not reported as an app error.
    expect(rules(report)).not.toContain('errors/failed-requests');
  });

  it('never touched the delete or checkout traps and sent no card data', () => {
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
  });

  it('stayed on the app’s own address the whole time', () => {
    expect(report.actionLog.length).toBeGreaterThan(20);
    for (const entry of report.actionLog) expect(entry.url.startsWith(app.url)).toBe(true);
    expect(result.report.notTested.join('\n')).not.toMatch(/Pages on other websites/);
  });

  it('used only generated, harmless test data and kept passwords out of the report', () => {
    const text = JSON.stringify(report);
    expect(text).toMatch(/shipcheck\+[0-9a-f]{8}@example\.com/);
    expect(text).not.toMatch(/Sc-[0-9a-f]{8}-[0-9a-f]{8}!9a/); // generated password
    expect(text).not.toMatch(/Wrong-[0-9a-f]{8}-pw/);
    expect(text).not.toMatch(/<script|' OR |\.\.\//i);
    const typed = report.actionLog
      .filter((a) => a.action === 'fill' && /password/i.test(a.intent))
      .map((a) => a.value);
    expect(typed.length).toBeGreaterThanOrEqual(3);
    for (const value of typed) expect(value).toBe('[hidden]');
  });

  it('counts every AI call, per run and per flow', () => {
    expect(result.llm).toBeDefined();
    const byFlow = result.llm?.byFlow ?? {};
    expect(Object.keys(byFlow).sort()).toEqual([
      'core',
      'forms',
      'landing',
      'login',
      'mobile',
      'signup',
    ]);
    expect(Object.values(byFlow).reduce((sum, n) => sum + n, 0)).toBe(result.llm?.total);
    expect(report.meta).toMatchObject({
      mode: 'full',
      llmCalls: result.llm?.total,
      llmCallLimit: 150,
      llmCallsByFlow: byFlow,
    });
    expect(result.llm?.total).toBeLessThan(40);
    expect(byFlow.mobile).toBeGreaterThan(0);
  });

  it('prints one progress line per flow', () => {
    expect(progress).toEqual(
      expect.arrayContaining([
        'Landing page… ✓',
        'Signing up… ✓',
        'Logging in… 1 issue',
        'Main feature… ✓',
        'Forms… 3 issues',
        'Phone layout… 1 issue',
        'Landing page on a phone… ✓',
        'Signing up on a phone… 1 issue',
        'Logging in on a phone… 1 issue',
        'Main feature on a phone… ✓',
      ]),
    );
  });
});

describe('a misbehaving AI that goes for the traps', () => {
  /** After logging in, this "AI" heads straight for account deletion, then for the checkout. */
  const attack = (target: 'delete' | 'pay') => (page: Page, done: number) => {
    const path = new URL(page.url()).pathname;
    if (target === 'delete') {
      if (path === '/dashboard.html')
        return [clickAt('xpath=//a[@href="/account.html"]', 'Account settings link')];
      return done < 3 ? [clickAt('xpath=//*[@id="delete-account"]', 'Confirm button')] : [];
    }
    if (path === '/dashboard.html')
      return [clickAt('xpath=//a[@href="/checkout.html"]', 'Upgrade link')];
    return [
      {
        selector: 'xpath=//*[@id="card-number"]',
        description: 'Number field',
        method: 'fill',
        arguments: ['4242424242424242'],
      },
    ];
  };
  const run = async (app: FixtureServer, target: 'delete' | 'pay', guardEnabled: boolean) =>
    runShipCheck(
      loadConfig(app.url, { yes: true, flows: 'signup,login,core' }, {}),
      {},
      {
        aiDriver: (budget) => createScriptedDriver({ budget, nextStep: attack(target) }),
        guardEnabled,
      },
    );

  it.each([
    ['guard on', true],
    ['guard OFF — backstop only', false],
  ] as const)('account deletion: counters stay at 0 (%s)', async (_name, guardEnabled) => {
    const app = await startFixtureServer();
    try {
      const { report } = await run(app, 'delete', guardEnabled);
      expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
      const deleteClicks = report.actionLog.filter(
        (a) => a.locator === 'xpath=//*[@id="delete-account"]',
      );
      expect(deleteClicks.length).toBeGreaterThan(0);
      if (guardEnabled) {
        for (const entry of deleteClicks) expect(entry.result).toBe('blocked');
      } else {
        // Clicked once per device (desktop, then the phone pass), each time stopped right after.
        expect(deleteClicks.map((a) => `${a.device} ${a.result}`)).toEqual([
          'desktop ok',
          'mobile ok',
        ]);
        expect(report.notTested).toContain(
          'Requests that could delete data, cancel something or start a payment were blocked by design (POST /api/delete-account)',
        );
        expect(report.meta.partial).toBe(true);
      }
      expect(report.findings.filter((f) => f.rule.startsWith('core/'))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['guard on', true],
    ['guard OFF — backstop only', false],
  ] as const)(
    'checkout: no card data typed or sent, Info note written (%s)',
    async (_name, guardEnabled) => {
      const app = await startFixtureServer();
      try {
        const { report } = await run(app, 'pay', guardEnabled);
        expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
        const info = report.findings.find((f) => f.rule === 'coverage/reached-payment');
        expect(info).toMatchObject({
          severity: 'info',
          title: 'Reached payment — stopped by design',
        });
        expect(
          report.actionLog.filter((a) => a.action === 'fill' && a.url.endsWith('/checkout.html')),
        ).toEqual([]);
        expect(report.notTested.join('\n')).toMatch(
          /reached the payment step and stopped before paying/,
        );
      } finally {
        await app.close();
      }
    },
  );
});

describe('a log-in that the server refuses with 4xx although the details are right', () => {
  it('is still reported as a broken login (Blocker), not hidden as a “refused submission”', async () => {
    const app = await startFixtureServer({ rejectAllLogins: true });
    try {
      const result = await runShipCheck(
        loadConfig(
          app.url,
          {
            yes: true,
            flows: 'signup,login',
            email: DEMO_ACCOUNT.email,
            password: DEMO_ACCOUNT.password,
            skipMobile: true,
          },
          {},
        ),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }) },
      );
      const report = ReportSchema.parse(result.report);
      const finding = report.findings.find((f) => f.rule === 'login/fails');
      expect(finding).toMatchObject({
        severity: 'blocker',
        flow: 'login',
        title: 'Users cannot log in',
      });
      expect(finding?.evidence.screenshots).toHaveLength(1);
      // Both attempts reached the server and both were answered 401.
      expect(app.hits).toMatchObject({ login: 2, loginFailed: 2 });
      expect(report.passed).not.toContain('Logging in with the correct password works');
      expect(report.verdict).toBe('not-ready');
      // The password never appears in the report.
      expect(JSON.stringify(report)).not.toContain(DEMO_ACCOUNT.password);
    } finally {
      await app.close();
    }
  });
});

describe('budgets', () => {
  it('stops at the AI call limit, still writes a report, and says what was not tested', async () => {
    const app = await startFixtureServer();
    try {
      const result = await runShipCheck(
        loadConfig(app.url, { yes: true }, {}),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }), maxLlmCalls: 4 },
      );
      expect(result.llm).toMatchObject({ total: 4, max: 4 });
      expect(result.report.meta).toMatchObject({ partial: true, llmCalls: 4, llmCallLimit: 4 });
      expect(result.report.notTested.join('\n')).toMatch(
        /the limit of 4 AI calls for one run was reached/,
      );
      expect(() => ReportSchema.parse(result.report)).not.toThrow();
      // The automatic checks are unaffected by the AI budget.
      expect(rules(result.report)).toContain('secrets/stripe-secret-key');
    } finally {
      await app.close();
    }
  });

  it('few AI calls left → phone flows are skipped with a note, the phone layout is still checked', async () => {
    const app = await startFixtureServer();
    try {
      // The desktop flows use 17 calls on this app, leaving 3 (less than the 10 a phone flow needs).
      const result = await runShipCheck(
        loadConfig(app.url, { yes: true }, {}),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }), maxLlmCalls: 20 },
      );
      expect(result.llm?.byFlow.mobile).toBeUndefined();
      expect(result.report.notTested).toEqual(
        expect.arrayContaining([
          'Landing page on a phone — skipped to stay within the limit of 20 AI calls for one run',
          'Signing up on a phone — skipped to stay within the limit of 20 AI calls for one run',
          'Logging in on a phone — skipped to stay within the limit of 20 AI calls for one run',
          'Main feature on a phone — skipped to stay within the limit of 20 AI calls for one run',
        ]),
      );
      expect(result.report.meta.partial).toBe(true);
      expect(rules(result.report)).toContain('mobile/sideways-scroll');
      expect(rules(result.report)).not.toContain('signup/button-does-nothing');
    } finally {
      await app.close();
    }
  });

  it('--skip-mobile leaves out the whole phone pass and says so', async () => {
    const app = await startFixtureServer();
    try {
      const result = await runShipCheck(
        loadConfig(app.url, { yes: true, skipMobile: true }, {}),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }) },
      );
      expect(result.report.actionLog.filter((a) => a.device === 'mobile')).toEqual([]);
      expect(result.report.findings.filter((f) => f.device === 'mobile')).toEqual([]);
      expect(result.llm?.byFlow.mobile).toBeUndefined();
      expect(result.report.notTested).toContain(
        'The phone-sized pass — left out with --skip-mobile',
      );
    } finally {
      await app.close();
    }
  });

  it('runs only the flows asked for with --flows', async () => {
    const app = await startFixtureServer();
    try {
      const result = await runShipCheck(
        loadConfig(app.url, { yes: true, flows: 'forms' }, {}),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }) },
      );
      expect(Object.keys(result.llm?.byFlow ?? {})).toEqual(['forms']);
      expect(app.hits).toMatchObject({ signup: 0, login: 0 });
      expect(result.report.notTested.join('\n')).toMatch(
        /Landing page, Signing up, Logging in, Main feature — left out with --flows/,
      );
    } finally {
      await app.close();
    }
  });
});

describe('command line without an AI key', () => {
  it('explains how to get a free key and exits with code 2, before opening anything', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const emptyDir = await mkdtemp(join(tmpdir(), 'shipcheck-nokey-')); // no .env here
    const app = await startFixtureServer();
    try {
      const keyNames = new Set([
        'GEMINI_API_KEY',
        'GOOGLE_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
      ]);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !keyNames.has(name)),
      );
      const child = spawn(
        join(root, 'node_modules/.bin/tsx'),
        [join(root, 'src/cli.ts'), app.url, '--yes'],
        {
          cwd: emptyDir,
          env,
        },
      );
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      const code = await new Promise((resolve) => child.on('exit', resolve));
      expect(code).toBe(2);
      expect(output).toContain('ShipCheck needs an AI key');
      expect(output).toContain('https://aistudio.google.com/apikey');
      expect(output).toContain('--no-ai');
      expect(output).not.toMatch(/\bat .*\.ts:\d+/); // no stack trace
      expect(app.requests).toEqual([]);
    } finally {
      await app.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
