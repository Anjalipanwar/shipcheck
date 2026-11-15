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
import { startFixtureServer } from '../helpers/fixture-server.js';
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
  if (done >= 2) {
    // …and then a very short one: too short to scrub from all text, but never shown as typed.
    return [
      {
        selector: 'xpath=//*[@id="login-password"]',
        description: 'Password field',
        method: 'fill',
        arguments: [SHORT],
      },
    ];
  }
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
      expect(typed).toContain(INVENTED);
      expect(typed.length).toBeGreaterThanOrEqual(3); // sign-up's own, a wrong one, the invented one

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
      // Whatever was typed into a password field is shown as hidden, whatever its length.
      expect(typed).toContain(SHORT);
      const passwordSteps = result.report.actionLog.filter(
        (entry) => entry.action === 'fill' && /password/.test(entry.locator ?? ''),
      );
      expect(passwordSteps.length).toBeGreaterThanOrEqual(4);
      expect(new Set(passwordSteps.map((entry) => entry.value))).toEqual(new Set(['[hidden]']));
      const json = outputs.find(([name]) => name === 'report.json')?.[1] ?? '';
      expect(json).not.toContain(`"${SHORT}"`);
      expect(json).not.toContain(`“${SHORT}”`);
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
});
