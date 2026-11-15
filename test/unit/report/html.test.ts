import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REPORT_CSS, REPORT_JS } from '../../../src/report/assets.js';
import { escapeHtml, renderBody, renderHtml, safeHref } from '../../../src/report/html.js';
import { finding, image, makeReport, sampleReport } from './fixtures.js';

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('escaping', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('only links ordinary web addresses', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('not a url')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it('text from the tested app can never become markup, in any field', () => {
    const evil = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const report = makeReport(
      [
        finding({
          title: `Title ${evil}`,
          whatHappened: evil,
          whyItMatters: evil,
          stepsToReproduce: [evil],
          evidence: {
            screenshots: [`shots/${evil}.jpg`],
            logs: [evil],
            url: 'javascript:alert(1)',
          },
          fixPrompt: `</pre>${evil}`,
        }),
      ],
      { passed: [evil], notTested: [evil] },
    );
    report.meta.url = `https://example.com/"><script>alert(2)</script>`;
    report.meta.shipcheckVersion = evil;
    const html = renderHtml(report, [image(`shots/${evil}.jpg`, 10, evil)]);
    expect(count(html, '<script>')).toBe(1); // only ShipCheck's own script
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

describe('renderHtml', () => {
  const { report, images } = sampleReport();
  const html = renderHtml(report, images);

  it('is one self-contained file: no outside scripts, styles, fonts or pictures', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/@import|url\(/);
    for (const src of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      expect(src[1]?.startsWith('data:image/')).toBe(true);
    }
  });

  it('locks the page down: only its own style and script may run, nothing may be loaded', () => {
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const hash = (text: string) => createHash('sha256').update(text).digest('base64');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`style-src 'sha256-${hash(REPORT_CSS)}'`);
    expect(policy).toContain(`script-src 'sha256-${hash(REPORT_JS)}'`);
    expect(policy).not.toContain('unsafe-inline');
    expect(html).toContain(`<style>${REPORT_CSS}</style>`);
    expect(html).toContain(`<script>${REPORT_JS}</script>`);
    expect(html).not.toMatch(/ style="| on[a-z]+="/);
  });

  it('has the sections of SPEC §5.3 in order', () => {
    const titles = [...html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/g)].map((match) => match[1]);
    expect(titles).toEqual([
      'Pre-launch report',
      'Verdict',
      'What this report covers',
      'Fix these first',
      'Your app as ShipCheck saw it',
      'All issues (4)',
      'What worked',
      'What we couldn’t test',
    ]);
    expect(html).toContain(
      '<title>ShipCheck report — Automatic checks found issues — myapp.example.com</title>',
    );
    expect(html).toContain('13 November 2026, 17:57 UTC');
    expect(html).toContain('not a security audit');
  });

  it('shows severity as text, not colour alone, and one card per finding', () => {
    expect(count(html, '<article class="card')).toBe(4);
    for (const label of ['1 Blocker', '1 Major', '1 Minor', '1 Info'])
      expect(html).toContain(label);
    expect(html).toContain('<span class="badge sev-blocker">Blocker</span>');
    expect(html).toContain('<span class="tag">AI judgement</span>');
    expect(html).toContain('<span class="tag">Desktop and phone</span>');
  });

  it('links "fix these first" to the matching cards and leaves Info out', () => {
    const first = /<ol class="first">.*?<\/ol>/s.exec(html)?.[0] ?? '';
    const targets = [...first.matchAll(/href="#(issue-\d+)"/g)].map((match) => match[1]);
    expect(targets).toEqual(['issue-1', 'issue-2', 'issue-3']);
    for (const id of targets) expect(html).toContain(`id="${id}"`);
    expect(first).not.toContain('Local address');
  });

  it('gives a copy button only to findings that have a fix prompt', () => {
    expect(count(html, 'class="copy"')).toBe(2);
    const prompt = /data-copy="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<pre id="${prompt}">`);
    expect(html).toContain('Add a &lt;meta name=&quot;description&quot;&gt; tag.');
  });

  it('gives every picture a text description', () => {
    for (const img of html.matchAll(/<img[^>]*>/g)) expect(img[0]).toMatch(/ alt="/);
    expect(html).toContain('alt="Screenshot: login failed (desktop)"');
    expect(html).toContain('aria-label="Enlarge screenshot: login failed (desktop)"');
  });

  it('says so plainly when there is nothing to report — and a --no-ai run is never “Ready”', () => {
    const empty = renderHtml(makeReport([], { passed: [], notTested: [] }));
    expect(empty).toContain('Automatic checks passed — app not tested as a user');
    expect(empty).not.toContain('Ready to launch');
    expect(empty).toContain('Nothing urgent.');
    expect(empty).toContain('No issues found.');
    expect(empty).toContain('No checks passed in this run.');
    expect(empty).toContain('Nothing — every planned check ran.');
    const full = makeReport([], {
      meta: { ...makeReport().meta, mode: 'full', model: 'm', llmCalls: 9 },
      passed: [],
      notTested: [],
    });
    expect(renderHtml(full)).toContain('Ready to launch');
  });
});

describe('screenshots and the size budget', () => {
  const shot = 'screenshots/01-desktop-home-page.jpg';
  const withShot = (title: string) => finding({ title, evidence: { screenshots: [shot] } });

  it('embeds a screenshot once, even when several findings point to it', () => {
    const html = renderHtml(makeReport([withShot('one'), withShot('two')]), [image(shot, 300)]);
    expect(count(html, 'src="data:image/jpeg;base64,')).toBe(1);
    expect(count(html, 'Same screenshot as above')).toBe(2); // second card + first-look section
  });

  it('stops embedding when the budget is used up and points to the file instead', () => {
    const images = [1, 2, 3].map((n) => image(`screenshots/0${n}-desktop-step.jpg`, 3000));
    const findings = images.map((img, n) =>
      finding({ title: `issue ${n}`, evidence: { screenshots: [img.file] } }),
    );
    const html = renderHtml(makeReport(findings), images, { maxImageBytes: 9000 });
    expect(count(html, 'src="data:image/jpeg;base64,')).toBe(2);
    expect(html).toContain('<a href="screenshots/03-desktop-step.jpg">');
    expect(html).toContain('is saved next to this report');
  });

  it('spends the budget on evidence before the first-look picture', () => {
    const images = [image(shot, 3000), image('screenshots/02-desktop-bug.jpg', 3000, 'bug')];
    const html = renderHtml(
      makeReport([finding({ evidence: { screenshots: ['screenshots/02-desktop-bug.jpg'] } })]),
      images,
      { maxImageBytes: 5000 },
    );
    expect(html).toContain('alt="Screenshot: bug (desktop)"');
    expect(html).not.toContain('alt="Screenshot: home page (desktop)"');
  });

  it('stays under 5 MB with the maximum of 60 large screenshots', () => {
    const images = Array.from({ length: 60 }, (_, n) =>
      image(`screenshots/${String(n + 1).padStart(2, '0')}-desktop-step.jpg`, 150_000),
    );
    const findings = images.map((img, n) =>
      finding({ title: `issue ${n}`, evidence: { screenshots: [img.file] } }),
    );
    const html = renderHtml(makeReport(findings), images);
    expect(Buffer.byteLength(html)).toBeLessThan(5_000_000);
    expect(count(html, 'src="data:image/jpeg;base64,')).toBeGreaterThan(15);
    expect(count(html, 'is saved next to this report')).toBeGreaterThan(0);
  });

  it('mentions a screenshot it has no file for instead of dropping the evidence', () => {
    const html = renderHtml(makeReport([withShot('one')]), []);
    expect(html).toContain(`Screenshot file: ${shot}`);
  });
});

describe('HTML structure snapshot', () => {
  it('matches the stored structure of a report that uses every part of the layout', () => {
    const { report, images } = sampleReport();
    const body = renderBody(report, images).replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,…');
    expect(body).toMatchSnapshot();
  });
});
