import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { CoverageArea, Report } from '../../src/report/schema.js';
import { runShipCheck } from '../../src/runner.js';
import { startFixtureServer, type FixtureOptions } from '../helpers/fixture-server.js';
import { createScriptedDriver, type ScriptedOptions } from '../helpers/scripted-driver.js';

/**
 * The terminal and the report must always agree (owner decision 2026-11-15): a progress line
 * may only end in "✓" if the report's "What this report covers" table says that part was
 * tested. Lines for one part of a row made of several checks (basic security, the phone flows)
 * are compared by hand in other tests; every one-to-one line is compared here.
 */
const AREA_OF: Record<string, CoverageArea> = {
  'Search engine basics (SEO)': 'seo',
  'Accessibility basics': 'accessibility',
  'Broken links and images': 'links',
  'Hidden errors': 'errors',
  'Phone layout': 'phone-layout',
  'Signing up': 'signup',
  'Logging in': 'login',
  'Main feature': 'core',
  Forms: 'forms',
};

function disagreements(progress: readonly string[], report: Report): string[] {
  const wrong: string[] = [];
  for (const line of progress) {
    const [label = '', result = ''] = line.split('… ');
    const area = AREA_OF[label];
    if (!area) continue;
    const row = report.coverage.find((entry) => entry.area === area);
    const tested = row?.state === 'no-problems' || (row?.state === 'problems' && !row.partial);
    if (result === '✓' && !tested) wrong.push(`“${line}” but the report says: ${row?.state}`);
    if (row?.state === 'no-problems' && result !== '✓')
      wrong.push(`“${line}” but the report says: no problems found`);
  }
  return wrong;
}

async function run(
  target: string | null,
  flags: Record<string, unknown>,
  server: FixtureOptions = {},
  driver: ScriptedOptions = {},
) {
  const app = await startFixtureServer(server);
  try {
    const progress: string[] = [];
    const { report } = await runShipCheck(
      loadConfig(target ?? app.url, { yes: true, ...flags }, {}),
      { progress: (line) => progress.push(line) },
      flags.ai === false
        ? {}
        : { aiDriver: (budget) => createScriptedDriver({ budget, ...driver }) },
    );
    return { progress, report };
  } finally {
    await app.close();
  }
}

describe('terminal progress lines and the report agree', () => {
  it.each([
    ['automatic checks only', { ai: false }],
    ['full check', {}],
  ])('an app that does not open (%s): no line shows ✓', async (_name, flags) => {
    const { progress, report } = await run('http://127.0.0.1:9', flags);
    expect(progress).toContain('Opening your app… it did not load');
    expect(progress.filter((line) => line.endsWith('✓'))).toEqual([]);
    expect(progress).toContain('Hidden errors… not checked (your app did not open)');
    expect(report.coverage.find((entry) => entry.area === 'errors')?.state).toBe('not-tested');
    expect(disagreements(progress, report)).toEqual([]);
  });

  it.each([
    ['the fixture as it is', {}, {}, {}],
    ['automatic checks only', { ai: false }, {}, {}],
    [
      'sign-up refused by the server (log-in then has no account)',
      {},
      { rejectAllSignups: true },
      {},
    ],
    ['an app without sign-up and log-in', {}, {}, { noAccounts: true }],
    ['only some flows chosen', { flows: 'landing,forms', skipMobile: true }, {}, {}],
  ] as const)(
    '%s: every line matches its row in the report',
    async (_name, flags, server, driver) => {
      const { progress, report } = await run(null, flags, server, driver);
      expect(progress.length).toBeGreaterThan(5);
      expect(disagreements(progress, report)).toEqual([]);
    },
  );
});
