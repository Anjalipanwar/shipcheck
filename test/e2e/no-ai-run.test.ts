import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_AGENT_SUFFIX } from '../../src/browser/devices.js';
import { loadConfig } from '../../src/config.js';
import { ReportSchema, type Finding, type Report } from '../../src/report/schema.js';
import { writeReport } from '../../src/report/write.js';
import { runShipCheck } from '../../src/runner.js';
import {
  FAKE_PUBLISHABLE_KEY,
  FAKE_SECRET_KEY,
  startFixtureServer,
  type FixtureServer,
} from '../helpers/fixture-server.js';

/**
 * Full deterministic run (--no-ai) against the buggy fixture app.
 * Expectations come from test/fixtures/buggy-app/BUGS.md.
 */
let app: FixtureServer;
let outDir: string;
let report: Report;
let reportText: string;
const progress: string[] = [];

beforeAll(async () => {
  app = await startFixtureServer();
  outDir = await mkdtemp(join(tmpdir(), 'shipcheck-e2e-'));
  const config = loadConfig(
    app.url,
    { ai: false, yes: true, out: outDir },
    { SHIPCHECK_PASSWORD: 'e2e-Secret-Pass-123' },
  );
  const result = await runShipCheck(config, { progress: (line) => progress.push(line) });
  await writeReport(outDir, result.report, result.screenshots, result.redact);
  reportText = await readFile(join(outDir, 'report.json'), 'utf8');
  report = ReportSchema.parse(JSON.parse(reportText));
});

afterAll(async () => {
  await app.close();
  await rm(outDir, { recursive: true, force: true });
});

const byRule = (rule: string): Finding[] => report.findings.filter((f) => f.rule === rule);
const only = (rule: string): Finding => {
  const found = byRule(rule);
  expect(found, `expected exactly one "${rule}" finding`).toHaveLength(1);
  return found[0] as Finding;
};

describe('planted bugs found without AI', () => {
  it('#3 uncaught error on the landing page', () => {
    const finding = only('errors/uncaught-exception');
    expect(finding).toMatchObject({
      category: 'errors',
      severity: 'minor',
      confidence: 'verified',
    });
    expect(finding.evidence.logs?.join(' ')).toMatch(/track/);
    expect(finding.evidence.logs).toHaveLength(1);
  });

  it('#4 broken internal link and broken image', () => {
    const link = only('links/broken-link');
    expect(link.severity).toBe('major');
    expect(link.evidence.logs).toEqual([
      expect.stringContaining('404 ' + app.url + '/pricing.html'),
    ]);
    const image = only('links/broken-image');
    expect(image.severity).toBe('minor');
    expect(image.evidence.logs).toEqual([
      expect.stringContaining('404 ' + app.url + '/img/team.png'),
    ]);
  });

  it('#5 missing meta description and Open Graph tags', () => {
    expect(only('seo/missing-description').severity).toBe('minor');
    const og = only('seo/missing-open-graph');
    expect(og.evidence.logs?.[0]).toBe(
      'Missing Open Graph tags: og:title, og:description, og:image',
    );
  });

  it('#6 secret key flagged as Blocker and masked; public key NOT flagged', () => {
    const secret = only('secrets/stripe-secret-key');
    expect(secret).toMatchObject({ severity: 'blocker', category: 'security' });
    expect(secret.evidence.logs?.[0]).toBe('Stripe secret key: sk_liv…eal1');
    expect(secret.evidence.url).toBe(`${app.url}/assets/app.js`);
    expect(reportText).not.toContain(FAKE_SECRET_KEY);
    expect(reportText).not.toContain(FAKE_SECRET_KEY.slice(8, 24));
    expect(reportText).not.toContain(FAKE_PUBLISHABLE_KEY);
    expect(report.findings.filter((f) => f.rule.startsWith('secrets/'))).toHaveLength(1);
  });
});

describe('expected extras and nothing else', () => {
  it('local address → Info "Local address — HTTPS not checked"', () => {
    const info = only('https/local-address');
    expect(info).toMatchObject({ severity: 'info', title: 'Local address — HTTPS not checked' });
    expect(byRule('https/missing')).toEqual([]);
  });

  it('missing security headers → one Minor finding (HSTS not expected on http)', () => {
    expect(only('headers/missing-security-headers').evidence.logs).toHaveLength(4);
  });

  it('reports exactly the expected set of findings — no false alarms', () => {
    expect(report.findings.map((f) => f.rule).sort()).toEqual(
      [
        'errors/uncaught-exception',
        'headers/missing-security-headers',
        'https/local-address',
        'links/broken-image',
        'links/broken-link',
        'secrets/stripe-secret-key',
        'seo/missing-description',
        'seo/missing-open-graph',
      ].sort(),
    );
  });

  it('verdict follows the rules: a Blocker means "not ready"', () => {
    expect(report.verdict).toBe('not-ready');
    expect(report.counts).toEqual({ blocker: 1, major: 1, minor: 5, info: 1 });
    expect(report.findings[0]?.severity).toBe('blocker');
  });

  it('every finding has evidence, plain wording and steps or a reason', () => {
    for (const finding of report.findings) {
      expect(
        (finding.evidence.logs?.length ?? 0) + finding.evidence.screenshots.length,
        finding.rule,
      ).toBeGreaterThan(0);
      expect(finding.title, finding.rule).not.toMatch(
        /\b(DOM|selector|stack trace|null|undefined|HTTP 4\d\d)\b/i,
      );
      expect(finding.whyItMatters.length, finding.rule).toBeGreaterThan(20);
    }
  });

  it('lists what worked and what could not be tested', () => {
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Home page opens',
        'Home page has a title',
        'robots.txt file exists',
      ]),
    );
    expect(report.passed.join('\n')).toMatch(
      /No serious accessibility problems found on the 2 pages/,
    );
    expect(report.notTested.join('\n')).toMatch(/need an AI key/);
    expect(report.meta).toMatchObject({
      mode: 'no-ai',
      model: null,
      llmCalls: 0,
      partial: false,
      url: `${app.url}/`,
    });
  });

  it('prints one progress line per step', () => {
    expect(progress[0]).toBe('Opening your app… ✓');
    expect(progress).toContain('Exposed secret keys… 1 issue');
    expect(progress).toContain('Secure connection (HTTPS)… not checked');
    expect(progress.length).toBeGreaterThanOrEqual(8);
  });
});

describe('safety (SPEC §7)', () => {
  it('never touched the delete-account or checkout traps, and submitted nothing', () => {
    expect(app.hits).toEqual({
      deleteAccount: 0,
      checkoutSubmit: 0,
      cardDataReceived: 0,
      signup: 0,
      login: 0,
      loginFailed: 0,
      contact: 0,
    });
    expect(app.requests.filter((r) => !r.startsWith('GET ') && !r.startsWith('HEAD '))).toEqual([]);
  });

  it('identified itself on every single request', () => {
    expect(app.userAgents.length).toBeGreaterThan(10);
    for (const agent of app.userAgents) expect(agent).toContain(USER_AGENT_SUFFIX);
    expect(app.userAgents.join()).not.toContain('HeadlessChrome');
  });

  it('wrote no password anywhere in the output folder', async () => {
    const names = await readdir(outDir, { recursive: true });
    expect(names).toEqual(expect.arrayContaining(['report.json', 'report.html', 'report.md']));
    for (const name of names) {
      if (!/\.(json|html|md)$/.test(name)) continue;
      expect(await readFile(join(outDir, name), 'utf8'), name).not.toContain('e2e-Secret-Pass-123');
    }
  });

  it('kept a precise action log and a home page screenshot', async () => {
    expect(report.actionLog.map((a) => `${a.action} ${a.url} ${a.result}`)).toEqual([
      `goto ${app.url}/ ok`,
      `goto ${app.url}/features.html ok`,
    ]);
    expect(await readdir(join(outDir, 'screenshots'))).toEqual(['01-desktop-home-page.jpg']);
  });
});

describe('robustness', () => {
  it('an app that does not load → one Blocker, a written report, no crash', async () => {
    const dead = await startFixtureServer();
    const url = dead.url;
    await dead.close();
    const result = await runShipCheck(loadConfig(url, { ai: false, yes: true }, {}));
    expect(result.report.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['landing/not-loading', 'blocker'],
    ]);
    expect(result.report.verdict).toBe('not-ready');
    expect(result.report.notTested.join()).toMatch(/home page did not load/);
    expect(() => ReportSchema.parse(result.report)).not.toThrow();
  });

  it('a home page that answers with an error → Blocker', async () => {
    const result = await runShipCheck(
      loadConfig(`${app.url}/does-not-exist`, { ai: false, yes: true }, {}),
    );
    expect(result.report.findings[0]).toMatchObject({
      rule: 'landing/not-loading',
      severity: 'blocker',
    });
    expect(result.report.findings[0]?.evidence.logs).toEqual(['Server answered: HTTP 404']);
    expect(result.report.findings[0]?.evidence.screenshots).toHaveLength(1);
  });
});
