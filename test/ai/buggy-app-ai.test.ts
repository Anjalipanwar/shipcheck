import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseModel, type ModelChoice } from '../../src/ai/models.js';
import { loadConfig } from '../../src/config.js';
import { ReportSchema, type Report } from '../../src/report/schema.js';
import { runShipCheck, type RunResult } from '../../src/runner.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * The real thing: a real AI model drives the flows against the buggy fixture app.
 * Run with "npm run test:ai". It needs an AI key in the environment or in ".env", and is
 * skipped without one (SPEC §10). It is not part of "npm test" because it spends the key's quota.
 */
if (existsSync('.env')) process.loadEnvFile('.env');
let model: ModelChoice | undefined;
try {
  model = chooseModel(process.env);
} catch {
  model = undefined;
}

describe.skipIf(!model)('real AI run against buggy-app (M4 acceptance)', () => {
  let app: FixtureServer;
  let result: RunResult;
  let report: Report;

  beforeAll(async () => {
    app = await startFixtureServer();
    result = await runShipCheck(
      loadConfig(app.url, { yes: true }, {}),
      {},
      { model: model as ModelChoice },
    );
    report = ReportSchema.parse(result.report);
    process.stdout.write(
      `AI calls: ${result.llm?.total} of ${result.llm?.max} ${JSON.stringify(result.llm?.byFlow)}\n` +
        report.findings.map((f) => `  ${f.severity.padEnd(8)}${f.rule}`).join('\n') +
        `\nNot tested:\n${report.notTested.map((line) => `  ${line}`).join('\n')}`,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  const rules = () => report.findings.map((f) => f.rule);

  it('detects planted bug #7 (no message on a wrong password)', () => {
    expect(rules()).toContain('login/no-error-on-wrong-password');
  });

  it('detects planted bug #2 (contact form accepts empty email and 5,000-character name)', () => {
    expect(rules()).toEqual(
      expect.arrayContaining(['forms/accepts-empty', 'forms/accepts-invalid']),
    );
    expect(app.contactSubmissions.some((s) => s.email === '' || s.name.length === 5000)).toBe(true);
  });

  it('detects planted bug #11 (double click sends the contact form twice) only there', () => {
    const duplicates = report.findings.filter((f) => f.rule === 'forms/duplicate-submit');
    expect(duplicates.map((f) => [f.severity, f.evidence.url])).toEqual([
      ['minor', `${app.url}/contact.html`],
    ]);
    // Opposite case: the newsletter form disables its button, so one sign-up at most.
    expect(app.hits.newsletter).toBeLessThanOrEqual(1);
    for (const finding of report.findings.filter((f) => f.rule.startsWith('forms/'))) {
      expect(finding.evidence.url).toBe(`${app.url}/contact.html`);
    }
  });

  it('never hits the delete counter (#9) and never submits checkout or card data (#10)', () => {
    expect(app.hits).toMatchObject({ deleteAccount: 0, checkoutSubmit: 0, cardDataReceived: 0 });
  });

  it('stays on the app’s own address', () => {
    for (const entry of report.actionLog) expect(entry.url.startsWith(app.url)).toBe(true);
    expect(report.notTested.join('\n')).not.toMatch(/Pages on other websites/);
  });

  it('raises no false Blocker or Major from the flows on things that work', () => {
    const fromFlows = report.findings.filter(
      (f) => /^(landing|signup|login|core)\//.test(f.rule) && f.severity !== 'info',
    );
    expect(fromFlows.map((f) => f.rule)).toEqual(['login/no-error-on-wrong-password']);
  });

  it('stays within the AI call budget and reports the count per flow', () => {
    expect(result.llm?.total).toBeGreaterThan(0);
    expect(result.llm?.total).toBeLessThanOrEqual(150);
    expect(report.meta.llmCalls).toBe(result.llm?.total);
    expect(report.meta.model).toBe(model?.stagehandModel);
  });

  it('keeps the AI key and the test passwords out of the report', () => {
    const text = JSON.stringify(report);
    expect(text).not.toContain(model?.apiKey);
    expect(text).not.toMatch(/Sc-[0-9a-f]{8}-[0-9a-f]{8}!9a/);
  });
});
