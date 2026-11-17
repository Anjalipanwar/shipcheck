import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { ProposedAction } from '../../src/browser/guard.js';
import { loadConfig } from '../../src/config.js';
import { renderStepSummary } from '../../src/report/markdown.js';
import { writeReport } from '../../src/report/write.js';
import { runShipCheck } from '../../src/runner.js';
import { summaryLines } from '../../src/summary.js';
import { DEMO_ACCOUNT, startFixtureServer } from '../helpers/fixture-server.js';
import { createScriptedDriver } from '../helpers/scripted-driver.js';

/**
 * SPEC §7.6 (owner decision 2026-11-15): no password may appear in any output — also not the
 * ones ShipCheck creates for its own test sign-ups, and not one the AI makes up by itself.
 */
const INVENTED = 'Zebra-Lamp-4471!';
const SHORT = 'q7';

/** A scripted "AI" that, in the main-feature flow, goes to the log-in page and makes up a password. */
const inventsPassword = (page: Page, done: number): ProposedAction[] => {
  const path = new URL(page.url()).pathname;
  if (path === '/dashboard.html') {
    return [
      {
        selector: 'xpath=//header//nav//a[@href="/login.html"]',
        description: 'Log in link',
        method: 'click',
        arguments: [],
      },
    ];
  }
  if (path !== '/login.html' || done > 3) return [];
  return [
    {
      selector: 'xpath=//*[@id="login-password"]',
      // A real model wrote the value into its own description of the step.
      description: `Type “${INVENTED}” into the password field`,
      method: 'fill',
      arguments: [INVENTED],
    },
  ];
};

describe('passwords never reach any output', () => {
  it('generated, wrong-on-purpose and AI-invented passwords are absent from every written file, the step summary and the progress lines', async () => {
    const app = await startFixtureServer();
    const outDir = await mkdtemp(join(tmpdir(), 'shipcheck-pw-'));
    try {
      const progress: string[] = [];
      let driver: ReturnType<typeof createScriptedDriver> | undefined;
      const result = await runShipCheck(
        loadConfig(app.url, { yes: true }, {}),
        { progress: (line) => progress.push(line) },
        {
          aiDriver: (budget) => {
            driver = createScriptedDriver({ budget, nextStep: inventsPassword });
            return driver;
          },
        },
      );
      // Every value the run typed into a password field, whoever chose it.
      const typed = [
        ...new Set(
          (driver?.acted ?? [])
            .filter((action) => action.method === 'fill' && /password/.test(action.selector))
            .map((action) => action.arguments?.[0] ?? ''),
        ),
      ].filter(Boolean);
      // The main-feature flow refuses to type into a password field at all, so the invented
      // one is never sent — but the model's own description of the step still names it.
      expect(typed).not.toContain(INVENTED);
      expect(typed.length).toBeGreaterThanOrEqual(2); // sign-up's own and a wrong one on purpose
      typed.push(INVENTED);

      await writeReport(outDir, result.report, result.screenshots, result.redact);
      const files = (await readdir(outDir, { recursive: true })).filter((name) =>
        /\.(html|md|json|txt)$/.test(name),
      );
      expect(files).toEqual(expect.arrayContaining(['report.html', 'report.md', 'report.json']));
      const outputs: [string, string][] = [
        ...(await Promise.all(
          files.map(
            async (name) => [name, await readFile(join(outDir, name), 'utf8')] as [string, string],
          ),
        )),
        // Straight from the returned report, as the terminal and the step summary use it.
        ['step summary', renderStepSummary(result.report)],
        ['returned report', JSON.stringify(result.report)],
        ['progress lines', progress.join('\n')],
      ];
      for (const [name, text] of outputs) {
        for (const password of typed.filter((value) => value.length >= 4)) {
          expect(text.includes(password), `${name} contains a password`).toBe(false);
        }
      }
      // The step itself is still on record — with the value hidden.
      expect(
        result.report.actionLog.some(
          (entry) => entry.locator?.includes('login-password') && entry.value === '[hidden]',
        ),
      ).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await app.close();
    }
  });

  // M7 (BUILD_PLAN): "nothing secret written anywhere — grep the output dir for the test password".
  it.each([
    ['--email / --password', { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password }, {}],
    [
      'SHIPCHECK_EMAIL / SHIPCHECK_PASSWORD',
      {},
      { SHIPCHECK_EMAIL: DEMO_ACCOUNT.email, SHIPCHECK_PASSWORD: DEMO_ACCOUNT.password },
    ],
  ])(
    'the test account’s password given with %s is typed into the app but is in no file and not in the terminal',
    async (_name, flags, env) => {
      const app = await startFixtureServer();
      const outDir = await mkdtemp(join(tmpdir(), 'shipcheck-pw-'));
      try {
        const progress: string[] = [];
        let driver: ReturnType<typeof createScriptedDriver> | undefined;
        const result = await runShipCheck(
          loadConfig(app.url, { yes: true, flows: 'signup,login,core', ...flags }, env),
          { progress: (line) => progress.push(line) },
          {
            aiDriver: (budget) => {
              driver = createScriptedDriver({ budget });
              return driver;
            },
          },
        );
        // The password really was used: typed into the log-in form, and the log-in worked.
        expect((driver?.acted ?? []).map((action) => action.arguments?.[0])).toContain(
          DEMO_ACCOUNT.password,
        );
        expect(app.hits.login).toBeGreaterThanOrEqual(1);

        const written = await writeReport(outDir, result.report, result.screenshots, result.redact);
        const files = (await readdir(outDir, { recursive: true })).filter(
          (name) => !/\.jpg$/.test(name),
        );
        expect(files).toEqual(expect.arrayContaining(['report.html', 'report.md', 'report.json']));
        const outputs: [string, string][] = [
          ...(await Promise.all(
            files
              .filter((name) => /\.\w+$/.test(name))
              .map(
                async (name) =>
                  [name, await readFile(join(outDir, name), 'utf8')] as [string, string],
              ),
          )),
          [
            'terminal summary',
            summaryLines(result.report, written.htmlPath, result.llm).join('\n'),
          ],
          ['progress lines', progress.join('\n')],
          ['step summary', renderStepSummary(result.report)],
        ];
        for (const [name, text] of outputs) {
          expect(text.includes(DEMO_ACCOUNT.password), `${name} contains the password`).toBe(false);
        }
      } finally {
        await rm(outDir, { recursive: true, force: true });
        await app.close();
      }
    },
  );

  // Audit A-02 / A-12: the app itself repeats the password — in the page address (a form sent
  // as a plain GET, so the password is form-encoded) and in its own message. Only ShipCheck's
  // final scrubbing stands between that text and the report, in every spelling it can take.
  it('a password the app repeats in its address and in its message is in no output, in any spelling', async () => {
    const ECHOED = 'Echo "Pass" & <42>!';
    const spellings = (value: string): string[] => [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ p: value }).toString().slice(2), // form-encoded: spaces as "+"
      JSON.stringify(value).slice(1, -1),
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    ];
    const app = await startFixtureServer();
    const outDir = await mkdtemp(join(tmpdir(), 'shipcheck-pw-'));
    try {
      const progress: string[] = [];
      const result = await runShipCheck(
        loadConfig(
          `${app.url}/get-login.html`,
          {
            yes: true,
            flows: 'login',
            skipMobile: true,
            email: DEMO_ACCOUNT.email,
            password: ECHOED,
          },
          {},
        ),
        { progress: (line) => progress.push(line) },
        { aiDriver: (budget) => createScriptedDriver({ budget }) },
      );
      // The app really did repeat it: the page address after sending carried it, hidden now.
      expect(JSON.stringify(result.report)).toContain('password=[hidden]');

      const written = await writeReport(outDir, result.report, result.screenshots, result.redact);
      const files = (await readdir(outDir, { recursive: true })).filter((name) =>
        /\.(html|md|json)$/.test(name),
      );
      const outputs: [string, string][] = [
        ...(await Promise.all(
          files.map(
            async (name) => [name, await readFile(join(outDir, name), 'utf8')] as [string, string],
          ),
        )),
        ['terminal summary', summaryLines(result.report, written.htmlPath, result.llm).join('\n')],
        ['progress lines', progress.join('\n')],
        ['step summary', renderStepSummary(result.report)],
      ];
      for (const [name, text] of outputs) {
        for (const spelling of spellings(ECHOED)) {
          expect(text.includes(spelling), `${name} contains the password as ${spelling}`).toBe(
            false,
          );
        }
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await app.close();
    }
  });

  it('a field where ShipCheck typed a password is shown as hidden, however short the password is', async () => {
    const app = await startFixtureServer();
    try {
      // Too short to be scrubbed from all text (that would damage ordinary words).
      const result = await runShipCheck(
        loadConfig(
          app.url,
          {
            yes: true,
            flows: 'login',
            skipMobile: true,
            email: DEMO_ACCOUNT.email,
            password: SHORT,
          },
          {},
        ),
        {},
        { aiDriver: (budget) => createScriptedDriver({ budget }) },
      );
      const passwordSteps = result.report.actionLog.filter(
        (entry) => entry.action === 'fill' && /password/.test(entry.locator ?? ''),
      );
      expect(passwordSteps.length).toBeGreaterThanOrEqual(1);
      expect(new Set(passwordSteps.map((entry) => entry.value))).toEqual(new Set(['[hidden]']));
      const json = JSON.stringify(result.report);
      expect(json).not.toContain(`"${SHORT}"`);
      expect(json).not.toContain(`“${SHORT}”`);
    } finally {
      await app.close();
    }
  });
});
