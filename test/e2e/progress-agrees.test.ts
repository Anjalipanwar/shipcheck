import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { CoverageArea, Report } from '../../src/report/schema.js';
import { runShipCheck } from '../../src/runner.js';
import { startFixtureServer, type FixtureOptions } from '../helpers/fixture-server.js';
import { createScriptedDriver, type ScriptedOptions } from '../helpers/scripted-driver.js';

/**
 * The terminal and the report must always agree (owner decision 2026-11-15): a progress line
 * may only end in "✓" if the report's "What this report covers" table says that part was
 * tested. A row made of several checks (basic security, the flows on a phone) is compared as a
 * group: "no problems found" needs a ✓ on every one of its lines, and a ✓ on every line needs a
 * row that was tested.
 */
const GROUPS: [CoverageArea, (label: string) => boolean][] = [
  [
    'security',
    (label) =>
      ['Secure connection (HTTPS)', 'Security settings', 'Exposed secret keys'].includes(label),
  ],
  ['phone-flows', (label) => /^(Signing up|Logging in|Main feature|Forms) on a phone$/.test(label)],
];
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
  for (const [area, belongs] of GROUPS) {
    const results = progress
      .map((line) => line.split('… '))
      .filter(([label = '']) => belongs(label))
      .map(([, result = '']) => result);
    if (results.length === 0) continue;
    const row = report.coverage.find((entry) => entry.area === area);
    const tested = row?.state === 'no-problems' || (row?.state === 'problems' && !row.partial);
    const allTicks = results.every((result) => result === '✓');
    if (allTicks && !tested)
      wrong.push(`all ${area} lines show ✓ but the report says: ${row?.state}`);
    if (row?.state === 'no-problems' && !allTicks)
      wrong.push(
        `the report says no problems in ${area}, but the lines say: ${results.join(', ')}`,
      );
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
