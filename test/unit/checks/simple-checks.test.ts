import { describe, expect, it } from 'vitest';
import type { EvidenceEvent } from '../../../src/browser/evidence.js';
import { checkA11y, type A11yViolation } from '../../../src/checks/a11y.js';
import { visibleTextLength } from '../../../src/checks/collect.js';
import { checkErrors } from '../../../src/checks/errors.js';
import { checkHeaders } from '../../../src/checks/headers.js';
import { checkHttps } from '../../../src/checks/https.js';
import { checkPerformance, SLOW_LCP_MS, SLOW_LOAD_MS } from '../../../src/checks/performance.js';
import { checkSeo, EMPTY_SHELL_MAX_CHARS, type SeoFacts } from '../../../src/checks/seo.js';
import type { CheckResult } from '../../../src/checks/types.js';

const rules = (result: CheckResult) => result.findings.map((f) => f.rule);
const severities = (result: CheckResult) => result.findings.map((f) => f.severity);
const everyFindingHasEvidence = (result: CheckResult) =>
  result.findings.every((f) => (f.evidence.logs?.length ?? 0) > 0 && f.confidence === 'verified');

describe('checkHttps', () => {
  it.each([
    'http://localhost:3000/',
    'http://127.0.0.1:5173/',
    'http://[::1]:8080/',
    'http://myapp.localhost/',
    'https://localhost/',
  ])('local address %s → Info "Local address — HTTPS not checked"', (url) => {
    const result = checkHttps({ targetUrl: url, finalUrl: url, insecureRequests: [] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: 'https/local-address',
      severity: 'info',
      title: 'Local address — HTTPS not checked',
    });
    expect(result.passed).toEqual([]);
    expect(everyFindingHasEvidence(result)).toBe(true);
  });

  it('a non-local http:// address → Major "no HTTPS"', () => {
    const result = checkHttps({
      targetUrl: 'http://myapp.example.com/',
      finalUrl: 'http://myapp.example.com/',
      insecureRequests: [],
    });
    expect(rules(result)).toEqual(['https/missing']);
    expect(severities(result)).toEqual(['major']);
    expect(result.findings[0]?.fixPrompt).toBeTruthy();
    expect(everyFindingHasEvidence(result)).toBe(true);
  });

  it('judges the address the browser ended on, not the one typed', () => {
    const redirectedToHttps = checkHttps({
      targetUrl: 'http://myapp.example.com/',
      finalUrl: 'https://myapp.example.com/',
      insecureRequests: [],
    });
    expect(redirectedToHttps.findings).toEqual([]);
    expect(redirectedToHttps.passed).toHaveLength(1);
  });

  it('a private network address is not treated as local', () => {
    const result = checkHttps({
      targetUrl: 'http://192.168.1.20/',
      finalUrl: 'http://192.168.1.20/',
      insecureRequests: [],
    });
    expect(rules(result)).toEqual(['https/missing']);
  });

  it('https with insecure parts → Minor mixed content, listed once each', () => {
    const result = checkHttps({
      targetUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      insecureRequests: ['http://cdn.test/a.js', 'http://cdn.test/a.js', 'http://cdn.test/b.png'],
    });
    expect(rules(result)).toEqual(['https/mixed-content']);
    expect(severities(result)).toEqual(['minor']);
    expect(result.findings[0]?.evidence.logs).toEqual([
      'http://cdn.test/a.js',
      'http://cdn.test/b.png',
    ]);
  });

  it('clean https → passes with no finding', () => {
    const result = checkHttps({
      targetUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      insecureRequests: [],
    });
    expect(result).toEqual({
      findings: [],
      passed: ['The app uses a secure connection (HTTPS)'],
      notTested: [],
    });
  });
});

describe('checkHeaders', () => {
  const all = {
    'content-security-policy': "default-src 'self'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };

  it('all present → no finding', () => {
    const result = checkHeaders({ url: 'https://example.com/', headers: all });
    expect(result.findings).toEqual([]);
    expect(result.passed).toEqual(['All 5 recommended security settings are switched on']);
  });

  it('header names are matched whatever their capitalisation', () => {
    const upper = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toUpperCase(), v]));
    expect(checkHeaders({ url: 'https://example.com/', headers: upper }).findings).toEqual([]);
  });

  it('none present on https → one Minor finding listing all five', () => {
    const result = checkHeaders({ url: 'https://example.com/', headers: {} });
    expect(severities(result)).toEqual(['minor']);
    expect(result.findings[0]?.evidence.logs).toHaveLength(5);
    expect(result.findings[0]?.title).toBe('5 recommended security settings are switched off');
  });

  it('HSTS is not expected on plain http', () => {
    const result = checkHeaders({ url: 'http://127.0.0.1:3000/', headers: {} });
    expect(result.findings[0]?.evidence.logs).toHaveLength(4);
    expect(result.findings[0]?.evidence.logs?.join()).not.toContain('Strict-Transport-Security');
  });

  it('CSP frame-ancestors counts as frame protection', () => {
    const headers = {
      ...all,
      'x-frame-options': '',
      'content-security-policy': "frame-ancestors 'none'",
    };
    expect(checkHeaders({ url: 'https://example.com/', headers }).findings).toEqual([]);
  });

  it('a wrong X-Content-Type-Options value counts as missing', () => {
    const result = checkHeaders({
      url: 'https://example.com/',
      headers: { ...all, 'x-content-type-options': 'yes' },
    });
    expect(result.findings[0]?.title).toBe('1 recommended security setting is switched off');
    expect(result.passed).toEqual(['4 of 5 recommended security settings are switched on']);
  });
});

describe('checkPerformance', () => {
  const url = 'https://example.com/';
  it('fast page → passes', () => {
    const result = checkPerformance({ url, loadMs: 900, lcpMs: 700 });
    expect(result.findings).toEqual([]);
    expect(result.passed[0]).toMatch(/0\.7 seconds/);
  });
  it('exactly at the thresholds is still fine', () => {
    expect(checkPerformance({ url, loadMs: SLOW_LOAD_MS, lcpMs: SLOW_LCP_MS }).findings).toEqual(
      [],
    );
  });
  it('slow main content → Minor', () => {
    const result = checkPerformance({ url, loadMs: 1000, lcpMs: SLOW_LCP_MS + 1 });
    expect(rules(result)).toEqual(['performance/slow-landing']);
    expect(severities(result)).toEqual(['minor']);
    expect(everyFindingHasEvidence(result)).toBe(true);
  });
  it('slow full load → Minor even without an LCP measurement', () => {
    expect(rules(checkPerformance({ url, loadMs: SLOW_LOAD_MS + 1, lcpMs: null }))).toEqual([
      'performance/slow-landing',
    ]);
  });
  it('no measurements → not tested, no finding', () => {
    const result = checkPerformance({ url, loadMs: null, lcpMs: null });
    expect(result.findings).toEqual([]);
    expect(result.notTested).toHaveLength(1);
  });
});

describe('checkSeo', () => {
  const good: SeoFacts = {
    page: {
      url: 'https://example.com/',
      title: 'Example',
      metaDescription: 'An example.',
      ogTitle: 'Example',
      ogDescription: 'An example.',
      ogImage: 'https://example.com/og.png',
      h1Count: 1,
      lang: 'en',
      hasFaviconLink: true,
    },
    faviconIcoExists: null,
    robotsTxtExists: true,
    sitemapXmlExists: true,
    rawTextLength: 5000,
  };
  const withPage = (page: Partial<SeoFacts['page']>): SeoFacts => ({
    ...good,
    page: { ...good.page, ...page },
  });

  it('a complete page → no findings, nine passes', () => {
    const result = checkSeo(good);
    expect(result.findings).toEqual([]);
    expect(result.passed).toHaveLength(9);
    expect(result.notTested).toEqual([]);
  });

  it.each([
    [withPage({ title: '' }), 'seo/missing-title'],
    [withPage({ metaDescription: '' }), 'seo/missing-description'],
    [withPage({ ogImage: '' }), 'seo/missing-open-graph'],
    [withPage({ h1Count: 0 }), 'seo/missing-h1'],
    [withPage({ h1Count: 3 }), 'seo/multiple-h1'],
    [withPage({ lang: '' }), 'seo/missing-lang'],
    [{ ...withPage({ hasFaviconLink: false }), faviconIcoExists: false }, 'seo/missing-favicon'],
    [{ ...good, robotsTxtExists: false }, 'seo/missing-robots-txt'],
    [{ ...good, sitemapXmlExists: false }, 'seo/missing-sitemap'],
    [{ ...good, rawTextLength: EMPTY_SHELL_MAX_CHARS - 1 }, 'seo/empty-shell'],
  ])('one thing missing → exactly one Minor finding (%#)', (facts, rule) => {
    const result = checkSeo(facts);
    expect(rules(result)).toEqual([rule]);
    expect(severities(result)).toEqual(['minor']);
    expect(everyFindingHasEvidence(result)).toBe(true);
    expect(result.findings[0]?.fixPrompt).toBeTruthy();
  });

  it('all three Open Graph tags missing → still one finding that names them', () => {
    const result = checkSeo(withPage({ ogTitle: '', ogDescription: '', ogImage: '' }));
    expect(rules(result)).toEqual(['seo/missing-open-graph']);
    expect(result.findings[0]?.evidence.logs?.[0]).toBe(
      'Missing Open Graph tags: og:title, og:description, og:image',
    );
  });

  it('/favicon.ico counts when the page has no icon link', () => {
    expect(
      checkSeo({ ...withPage({ hasFaviconLink: false }), faviconIcoExists: true }).findings,
    ).toEqual([]);
  });

  it('things we could not check are "not tested", never findings', () => {
    const result = checkSeo({
      ...withPage({ hasFaviconLink: false }),
      faviconIcoExists: null,
      robotsTxtExists: null,
      sitemapXmlExists: null,
      rawTextLength: null,
    });
    expect(result.findings).toEqual([]);
    expect(result.notTested).toHaveLength(4);
  });

  it('text length exactly at the threshold is fine', () => {
    expect(checkSeo({ ...good, rawTextLength: EMPTY_SHELL_MAX_CHARS }).findings).toEqual([]);
  });
});

describe('visibleTextLength (empty-shell measurement)', () => {
  it('a JavaScript-only shell has almost no text', () => {
    const shell =
      '<!doctype html><html><head><title>My App</title><style>body{margin:0}</style></head><body><div id="root"></div><script>window.__DATA__={"a":"lots of text that is not visible ".repeat(50)}</script><noscript>You need to enable JavaScript to run this app.</noscript></body></html>';
    expect(visibleTextLength(shell)).toBe(0);
  });
  it('counts real page text and ignores tags, comments and entities', () => {
    expect(
      visibleTextLength('<body><!-- hidden --><h1>Hello</h1>\n\n <p>big&nbsp;world</p></body>'),
    ).toBe('Hello big world'.length);
  });
});

describe('checkA11y', () => {
  const violation = (
    id: string,
    impact: string | null,
    count = 1,
    pageUrl = 'https://example.com/',
  ): A11yViolation => ({
    id,
    impact,
    help: `help for ${id}`,
    count,
    pageUrl,
  });

  it('no pages scanned → not tested', () => {
    expect(checkA11y([], 0)).toEqual({
      findings: [],
      passed: [],
      notTested: ['Accessibility basics — the scan could not run'],
    });
  });
  it('only minor/moderate problems → passes (SPEC: serious and critical only)', () => {
    const result = checkA11y(
      [violation('region', 'moderate'), violation('x', 'minor'), violation('y', null)],
      2,
    );
    expect(result.findings).toEqual([]);
    expect(result.passed).toHaveLength(1);
  });
  it('serious and critical problems → one grouped Minor finding in plain English', () => {
    const result = checkA11y(
      [
        violation('color-contrast', 'serious', 3),
        violation('color-contrast', 'serious', 2, 'https://example.com/about'),
        violation('image-alt', 'critical'),
        violation('region', 'moderate'),
        violation('some-new-rule', 'serious'),
      ],
      2,
    );
    expect(rules(result)).toEqual(['a11y/serious-violations']);
    expect(severities(result)).toEqual(['minor']);
    const logs = result.findings[0]?.evidence.logs ?? [];
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatch(/too pale.*5 places.*example\.com\/, https:\/\/example\.com\/about/);
    expect(logs[2]).toContain('help for some-new-rule');
    expect(logs.join()).not.toContain('region');
  });
});

describe('checkErrors', () => {
  const at = {
    at: '2026-11-13T00:00:00.000Z',
    device: 'desktop' as const,
    pageUrl: 'https://example.com/',
  };
  const bad = (
    status: number,
    resourceType: string,
    url = 'https://example.com/api/x',
  ): EvidenceEvent => ({
    ...at,
    kind: 'bad-response',
    status,
    resourceType,
    url,
    method: 'GET',
  });

  it('nothing happened → two passes, no findings', () => {
    const result = checkErrors([]);
    expect(result.findings).toEqual([]);
    expect(result.passed).toHaveLength(2);
  });

  it('uncaught crash → Minor, repeated messages are counted not repeated', () => {
    const crash: EvidenceEvent = { ...at, kind: 'page-error', text: 'x is not defined' };
    const result = checkErrors([crash, crash, crash]);
    expect(rules(result)).toEqual(['errors/uncaught-exception']);
    expect(severities(result)).toEqual(['minor']);
    expect(result.findings[0]?.evidence.logs).toEqual([
      'x is not defined — on https://example.com/ (×3)',
    ]);
  });

  it('console errors → Minor; the browser’s own "Failed to load resource" lines are ignored', () => {
    const result = checkErrors([
      {
        ...at,
        kind: 'console-error',
        text: 'Failed to load resource: the server responded with a status of 404',
      },
    ]);
    expect(result.findings).toEqual([]);
    expect(
      rules(checkErrors([{ ...at, kind: 'console-error', text: 'Hydration failed' }])),
    ).toEqual(['errors/console-errors']);
  });

  it('server error on a data request → Major', () => {
    const result = checkErrors([bad(500, 'fetch'), bad(503, 'xhr')]);
    expect(rules(result)).toEqual(['errors/server-error']);
    expect(severities(result)).toEqual(['major']);
  });

  it('missing script or stylesheet → Major', () => {
    const result = checkErrors([bad(404, 'script', 'https://example.com/app.js')]);
    expect(rules(result)).toEqual(['errors/missing-code-file']);
    expect(severities(result)).toEqual(['major']);
  });

  it('refused data request (4xx) → Minor', () => {
    const result = checkErrors([bad(403, 'fetch')]);
    expect(rules(result)).toEqual(['errors/failed-requests']);
    expect(severities(result)).toEqual(['minor']);
  });

  it('broken images and page links are left to the links check', () => {
    expect(
      checkErrors([bad(404, 'image'), bad(404, 'document'), bad(404, 'font')]).findings,
    ).toEqual([]);
  });

  it('requests cancelled by navigation or by our own domain lock are not errors', () => {
    const failed = (text: string, resourceType = 'fetch'): EvidenceEvent => ({
      ...at,
      kind: 'request-failed',
      url: 'https://example.com/api',
      method: 'GET',
      resourceType,
      text,
    });
    expect(
      checkErrors([failed('net::ERR_ABORTED'), failed('net::ERR_BLOCKED_BY_CLIENT')]).findings,
    ).toEqual([]);
    expect(checkErrors([failed('net::ERR_CONNECTION_REFUSED', 'image')]).findings).toEqual([]);
    expect(rules(checkErrors([failed('net::ERR_CONNECTION_REFUSED')]))).toEqual([
      'errors/failed-requests',
    ]);
  });

  it('events of other kinds are ignored', () => {
    expect(
      checkErrors([
        { ...at, kind: 'blocked-navigation', url: 'https://other.test/' },
        { ...at, kind: 'dialog', text: 'Sure?', dialogType: 'confirm' },
        { ...at, kind: 'insecure-request', url: 'http://x.test/a.js', resourceType: 'script' },
      ]).findings,
    ).toEqual([]);
  });
});
