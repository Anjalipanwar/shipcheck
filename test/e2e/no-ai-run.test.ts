import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  it('#8 the features page scrolls sideways on a phone — Minor, phone only, with a screenshot', () => {
    const finding = only('mobile/sideways-scroll');
    expect(finding).toMatchObject({
      title: 'A page scrolls sideways on a phone',
      severity: 'minor',
      category: 'mobile',
      device: 'mobile',
      confidence: 'verified',
    });
    expect(finding.evidence.url).toBe(`${app.url}/features.html`);
    expect(finding.evidence.logs).toEqual([
      expect.stringMatching(
        /features\.html: page is \d+ px wide on a 390 px screen — widest part: table\.plans, 900 px$/,
      ),
    ]);
    expect(finding.evidence.screenshots).toEqual([
      'screenshots/02-mobile-layout-features-html.jpg',
    ]);
    // Nothing about layout is ever said about the desktop.
    expect(report.findings.filter((f) => f.category === 'mobile' && f.device !== 'mobile')).toEqual(
      [],
    );
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Buttons and menu links are big enough to tap on a phone',
        'No buttons are cut off or covered on a phone',
      ]),
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
        'mobile/sideways-scroll',
        'secrets/stripe-secret-key',
        'seo/missing-description',
        'seo/missing-open-graph',
      ].sort(),
    );
  });

  it('payment script on the home page: blocked by design, listed as not tested, no false finding', () => {
    expect(app.requests).toContain('GET /assets/pay-widget.js');
    const payment = report.notTested.find((line) => line.startsWith('Payment requests'));
    expect(payment).toMatch(
      /^Payment requests were blocked by design \(to .+\), so paying was not tested$/,
    );
    for (const host of ['js.stripe.com', 'r.stripe.com', 'api.stripe.com']) {
      expect(payment).toContain(host);
    }
    expect(report.notTested).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Error messages caused by this blocking were ignored \(\d+ in total\) — they are not problems in your app$/,
        ),
      ]),
    );
    // Bug #6 (the exposed Stripe secret key) rightly names Stripe; nothing else may.
    const findingsText = JSON.stringify(
      report.findings.filter((f) => f.rule !== 'secrets/stripe-secret-key'),
    );
    expect(findingsText).not.toMatch(/stripe|PayWidget|Failed to fetch/i);
  });

  it('broken link severity follows placement: the header “Pricing” link stays Major', () => {
    const link = only('links/broken-link');
    expect(link.title).toBe(
      'The “Pricing” link in your main menu leads to a page that does not exist',
    );
    expect(link.evidence.logs?.[0]).toContain('(“Pricing” in the page header or main menu)');
    expect(byRule('links/broken-other-link')).toEqual([]);
  });

  it('verdict: a --no-ai run is never a launch verdict — “Automatic checks found issues”', () => {
    expect(report.verdict).toBe('checks-found-issues');
    expect(report.counts).toEqual({ blocker: 1, major: 1, minor: 6, info: 1 });
    expect(report.findings[0]?.severity).toBe('blocker');
  });

  it('coverage: the visitor areas need the full check; every automatic area was really tested', () => {
    expect(report.coverage.map((e) => [e.area, e.state, e.note ?? ''])).toEqual([
      ['signup', 'not-tested', 'this needs the full check'],
      ['login', 'not-tested', 'this needs the full check'],
      ['core', 'not-tested', 'this needs the full check'],
      ['forms', 'not-tested', 'this needs the full check'],
      ['phone-flows', 'not-tested', 'this needs the full check'],
      ['phone-layout', 'problems', ''],
      ['errors', 'problems', ''],
      ['links', 'problems', ''],
      ['seo', 'problems', ''],
      ['security', 'problems', ''],
      ['accessibility', 'no-problems', ''],
    ]);
  });

  it('“Ready to launch” appears in none of the written files', async () => {
    for (const file of ['report.html', 'report.md', 'report.json']) {
      expect(await readFile(join(outDir, file), 'utf8'), file).not.toContain('Ready to launch');
    }
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
    expect(report.notTested.join('\n')).toMatch(
      /on desktop and on a phone — these need the full check \(this run was automatic checks only\)\. The phone layout was checked/,
    );
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
      newsletter: 0,
      track: 0,
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
    expect(
      report.actionLog.map(
        (a) => `${a.device} ${a.action} ${a.url.replace(app.url, '')} ${a.result}`,
      ),
    ).toEqual([
      'desktop goto / ok',
      'desktop goto /features.html ok',
      // Phone layout: home page, then menu links first (no menu button to tap on this app).
      'mobile goto / ok',
      'mobile goto /features.html ok',
      'mobile goto /pricing.html failed',
      'mobile goto /contact.html ok',
      'mobile goto /login.html ok',
      'mobile goto /signup.html ok',
    ]);
    // A phone screenshot only where the layout has a problem (bug #8).
    expect(await readdir(join(outDir, 'screenshots'))).toEqual([
      '01-desktop-home-page.jpg',
      '02-mobile-layout-features-html.jpg',
    ]);
  });
});

describe('planted bug #12 — runs started on the menu pages (they are not linked from other pages)', () => {
  const run = async (path: string) =>
    (await runShipCheck(loadConfig(app.url + path, { ai: false, yes: true }, {}))).report;

  it('/menu-broken.html → Major “The menu does not open on a phone”, phone only', async () => {
    const menu = (await run('/menu-broken.html')).findings.filter((f) => f.rule.includes('menu'));
    expect(menu.map((f) => [f.rule, f.severity, f.device, f.title])).toEqual([
      ['mobile/menu-does-not-open', 'major', 'mobile', 'The menu does not open on a phone'],
    ]);
    expect(menu[0]?.evidence.screenshots).toHaveLength(2);
  });

  it('/menu-ok.html → no menu finding, “The menu opens on a phone” under what worked', async () => {
    const report = await run('/menu-ok.html');
    expect(report.findings.filter((f) => f.rule.includes('menu'))).toEqual([]);
    expect(report.passed).toContain('The menu opens on a phone');
  });

  it('the default run from “/” never reaches the menu pages', () => {
    expect(report.actionLog.some((a) => /menu-(ok|broken)/.test(a.url ?? ''))).toBe(false);
  });
});

/** Serves a few synthetic pages on a random local port for one test. */
async function serve(pages: Record<string, string>): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const body = pages[(req.url ?? '/').split('?')[0] ?? '/'];
    res
      .writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
      .end(body ?? 'Not found');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe('menu check on every phone page, each distinct menu once (owner decision 2026-11-15)', () => {
  /** A header whose phone menu opens only if `works`; links are shown directly on a desktop. */
  const header = (label: string, links: string[], works: boolean, current = '') => `
    <header><a href="/">Home</a>
      <button class="toggle" aria-label="${label}" aria-expanded="false" aria-controls="m">☰</button>
      <nav id="m">${links.map((l) => `<a href="${l}"${l === current ? ' aria-current="page"' : ''}>${l.slice(1)}</a>`).join('')}</nav>
    </header>${works ? `<script>document.querySelector('.toggle').onclick = () => document.getElementById('m').classList.add('open');</script>` : ''}`;
  const page = (title: string, head: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
     <style>body{margin:0;font:16px sans-serif}header a,.toggle{display:inline-block;min-width:48px;min-height:48px;padding:12px}
     .toggle{display:none}@media (max-width:767px){.toggle{display:inline-block}#m{display:none}#m.open{display:block}}</style></head>
     <body>${head}<main><h1>${title}</h1></main></body></html>`;
  const SITE = ['/about', '/shop', '/help', '/contact'];

  it('one broken menu on four pages → one finding; another broken menu → its own finding naming its page', async () => {
    const site = await serve({
      '/': page('Home', header('Menu', SITE, false)),
      '/about': page('About', header('Menu', SITE, false, '/about')), // same header, current page marked
      '/contact': page('Contact', header('Menu', SITE, false, '/contact')),
      '/shop': page('Shop', header('Open navigation', ['/cart-help', '/returns'], false)),
      '/help': page('Help', header('Help menu', ['/faq'], true)),
    });
    try {
      const { report } = await runShipCheck(
        loadConfig(`${site.url}/`, { ai: false, yes: true }, {}),
      );
      const menus = report.findings.filter((f) => f.rule === 'mobile/menu-does-not-open');
      expect(menus.map((f) => [f.title, f.severity, f.evidence.url])).toEqual([
        ['The menu does not open on a phone', 'major', `${site.url}/`],
        ['The menu on /shop does not open on a phone', 'major', `${site.url}/shop`],
      ]);
      expect(report.passed).toContain('The menu opens on a phone');
      const taps = report.actionLog.filter((a) => a.intent.startsWith('Tap the menu button'));
      expect(taps.map((a) => [a.intent, new URL(a.url ?? '').pathname])).toEqual([
        ['Tap the menu button “Menu”', '/'],
        ['Tap the menu button “Open navigation”', '/shop'],
        ['Tap the menu button “Help menu”', '/help'],
      ]);
    } finally {
      site.close();
    }
  });
});

describe('covered button in a full run (owner decision 2026-11-15)', () => {
  it('a closable cookie banner → Minor “covers … until it’s closed”, screenshot taken with the banner', async () => {
    const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Banner</title>
      <style>body{margin:0;font:16px sans-serif}.cta{display:block;margin:700px 16px 0;width:200px;height:48px}
      .bar{position:fixed;bottom:0;left:0;right:0;height:220px;background:#eee}.bar button{min-height:44px;margin:4px}</style></head>
      <body><main><h1>Banner</h1><button class="cta">Sign up</button></main>
      <div class="bar"><p>We use cookies.</p><button id="accept">Accept all</button><button id="reject">Reject all</button></div>
      <script>document.getElementById('accept').onclick = () => { document.title = 'ACCEPTED'; };
        document.getElementById('reject').onclick = () => document.querySelector('.bar').remove();</script></body></html>`;
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await runShipCheck(
        loadConfig(`http://127.0.0.1:${port}/`, { ai: false, yes: true }, {}),
      );
      const covered = result.report.findings.filter((f) =>
        f.rule.startsWith('mobile/button-covered'),
      );
      expect(covered.map((f) => [f.rule, f.severity, f.title])).toEqual([
        [
          'mobile/button-covered-until-closed',
          'minor',
          'A cookie banner covers the “Sign up” button until it’s closed',
        ],
      ]);
      expect(covered[0]?.evidence.screenshots).toHaveLength(1);
      // A page without any links was still checked: “Broken links” is ✓, not “nothing could be checked”.
      expect(result.report.coverage.find((e) => e.area === 'links')).toEqual({
        area: 'links',
        state: 'no-problems',
      });
      expect(
        result.report.actionLog
          .filter((a) => a.intent.startsWith('Close the banner'))
          .map((a) => [a.intent, a.result]),
      ).toEqual([['Close the banner covering a button (“Reject all”)', 'ok']]);
    } finally {
      server.close();
    }
  });
});

describe('coverage when the time runs out', () => {
  it('checks the time limit stopped are “Not tested: the time limit was reached”, with what to do, and the verdict stays neutral', async () => {
    const config = loadConfig(app.url, { ai: false, yes: true }, {});
    // The smallest --max-minutes is 1; a run this short can only open the home page.
    const result = await runShipCheck({ ...config, maxMinutes: 0.001 });
    const notes = Object.fromEntries(result.report.coverage.map((e) => [e.area, e.note]));
    const advice = 'the time limit was reached. Run ShipCheck again with a higher --max-minutes.';
    expect(notes.seo).toBe(advice);
    expect(notes.links).toBe(advice);
    expect(notes.security).toMatch(/the time limit was reached/);
    expect(notes['phone-layout']).toBe(
      'ShipCheck ran out of time before this part. Run ShipCheck again with a higher --max-minutes.',
    );
    expect(result.report.coverage.find((e) => e.area === 'seo')?.state).toBe('not-tested');
    expect(result.report.verdict).not.toBe('ready');
    expect(() => ReportSchema.parse(result.report)).not.toThrow();
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
    expect(result.report.verdict).toBe('checks-found-issues');
    expect(result.report.notTested.join()).toMatch(/home page did not load/);
    // Nothing was tested — not even Hidden errors, although that check still looks at the run.
    expect(result.report.coverage.every((e) => e.state === 'not-tested')).toBe(true);
    expect(result.report.coverage[0]?.note).toBe(
      'the home page did not load. Fix that first, then run ShipCheck again.',
    );
    expect(new Set(result.report.coverage.map((e) => e.note))).toEqual(
      new Set(['the home page did not load. Fix that first, then run ShipCheck again.']),
    );
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
