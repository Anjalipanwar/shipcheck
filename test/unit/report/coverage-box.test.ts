import { describe, expect, it } from 'vitest';
import { coverageBox, renderHtml } from '../../../src/report/html.js';
import {
  coverageMarkdown,
  renderMarkdown,
  renderStepSummary,
} from '../../../src/report/markdown.js';
import { REPORT_CSS } from '../../../src/report/assets.js';
import { coverageView } from '../../../src/report/coverage-view.js';
import {
  countsLine,
  coverageLine,
  fullCheckCommand,
  SEVERITY_LEGEND,
  severityCount,
  VERDICT_LABEL,
  verdictSummary,
} from '../../../src/report/present.js';
import type { Report } from '../../../src/report/schema.js';
import { coverageFor, finding, makeReport } from './fixtures.js';

/** "What this report covers" — owner decisions 2026-11-15 (four states, two groups). */
const minor = finding({ severity: 'minor', category: 'seo', rule: 'seo/x' });
const noAi = makeReport([minor]);
const fullMeta = {
  ...noAi.meta,
  mode: 'full' as const,
  model: 'google/gemini',
  llmCalls: 42,
  llmCallLimit: 150,
};
const full = (marks: Parameters<typeof coverageFor>[1] = {}, findings = [minor]): Report =>
  makeReport(findings, { meta: fullMeta, coverage: coverageFor('full', marks, findings) });
const stopped = full({
  login:
    'ShipCheck has no test account (signing up did not finish). Add a test account (see the README).',
  core: 'your AI key’s quota ran out. Try again tomorrow, or use a paid key.',
  'phone-flows': 'Log-in: no log-in form was found. Check this part by hand.',
});
const blocker = finding({
  severity: 'blocker',
  flow: 'signup',
  rule: 'signup/broken',
  title: 'Sign-up does nothing',
});
const major = finding({ severity: 'major', flow: 'signup', rule: 'signup/slow', title: 'Slow' });
const withProblems = full({}, [minor, major, blocker]);
const byChoice = full(
  {
    signup: { state: 'skipped', note: 'you gave a test account' },
    forms: { state: 'absent', note: 'no form was found' },
    'phone-flows': { state: 'skipped', note: 'you used --skip-mobile' },
    'phone-layout': { state: 'skipped', note: 'you used --skip-mobile' },
  },
  [],
);

describe('the box in report.html', () => {
  it('snapshot: automatic checks only', () => {
    expect(coverageBox(noAi)).toMatchSnapshot();
  });
  it('snapshot: full check that stopped early', () => {
    expect(coverageBox(stopped)).toMatchSnapshot();
  });

  it('sits directly under the verdict banner, open, in both report types', () => {
    for (const report of [noAi, full(), stopped]) {
      const html = renderHtml(report);
      const verdictEnd = html.indexOf('</section>', html.indexOf('class="verdict'));
      expect(html.indexOf('<section class="coverage"')).toBe(verdictEnd + '</section>\n'.length);
      expect(html).not.toMatch(/<details[^>]*>\s*<summary>What this report covers/);
    }
  });

  it('two groups with headings, visitor areas first, in the agreed order and wording', () => {
    const box = coverageBox(full());
    const order = [
      'Using your app like a visitor (full check only)',
      'Sign-up',
      'Log-in',
      'Main feature',
      'Forms (including wrong or missing input)',
      'Using it on a phone',
      'Automatic checks (always run)',
      'Phone screen layout',
      'Hidden errors',
      'Broken links',
      'SEO',
      'Basic security',
      'Accessibility',
    ].map((label) => box.indexOf(`>${label}</th>`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('✓ “No problems found” for a clean area; ⚠ “N problems” in the colour of the worst, linking to it', () => {
    const html = renderHtml(withProblems);
    const box = html.slice(html.indexOf('<section class="coverage"'), html.indexOf('look-title'));
    expect(box.match(/class="st-no-problems"/g)).toHaveLength(9);
    expect(box).toContain('<span class="state">No problems found</span>');
    const signup =
      /<tr class="st-problems s-blocker"><th scope="row">Sign-up<\/th>.*?<a href="#([^"]+)">2 problems<\/a>/.exec(
        box,
      );
    expect(signup).not.toBeNull();
    // The link lands on the worst finding of that area.
    expect(html).toContain(`id="${signup?.[1]}-title">Sign-up does nothing</h4>`);
    expect(box).toMatch(/<tr class="st-problems s-minor"><th scope="row">SEO<\/th>.*?>1 problem</);
  });

  it('○ “Not tested” is grey, never ✗, gives the reason and what to do, and keeps the verdict at “Partly tested”', () => {
    const box = coverageBox(stopped);
    expect(stopped.verdict).toBe('partly-tested');
    expect(box.match(/class="st-not-tested"/g)).toHaveLength(3);
    expect(box).toContain(
      '<span class="icon" aria-hidden="true">○</span> <span class="state">Not tested: your AI key’s quota ran out. Try again tomorrow, or use a paid key.</span>',
    );
    expect(box).not.toContain('✗');
    expect(REPORT_CSS).toMatch(/\.cov \.st-not-tested td[^{]*\{color:var\(--muted\)\}/);
  });

  it('— “Skipped by your choice” / “Not in your app” do not block “Ready to launch”', () => {
    expect(byChoice.verdict).toBe('ready');
    const box = coverageBox(byChoice);
    expect(box).toContain(
      '>—</span> <span class="state">Skipped by your choice: you gave a test account<',
    );
    expect(box).toContain('>—</span> <span class="state">Not in your app: no form was found<');
    expect(box).toContain('Skipped by your choice: you used --skip-mobile');
    expect(coverageLine(byChoice)).toContain(
      'skipped by your choice: Sign-up, Using it on a phone, Phone screen layout; not in your app: Forms (including wrong or missing input)',
    );
  });

  it('a problem that belongs to no row is still mentioned, so the box never looks cleaner than the counts', () => {
    const slow = finding({ rule: 'performance/slow-landing', category: 'performance' });
    const report = full({}, [slow]);
    const line =
      '1 more problem is not part of one of these areas (for example page speed or the home page itself). See “All issues”.';
    expect(coverageBox(report)).toContain(`<p class="other">⚠ ${line}</p>`);
    expect(coverageMarkdown(report, '##').join('\n')).toContain(`⚠ ${line}`);
    expect(coverageBox(full())).not.toContain('class="other"');
  });

  it('problems in an area that was also blocked: both are shown', () => {
    const partial = full({ login: 'no test account. Add a test account (see the README).' }, [
      finding({ severity: 'major', flow: 'login', rule: 'login/x' }),
    ]);
    expect(partial.verdict).toBe('fix-before-launch'); // problems found still decide
    expect(coverageBox(partial)).toContain(
      '<span class="why">Only partly tested: no test account. Add a test account (see the README).</span>',
    );
  });

  it('full check: says “tried to”, never that it signed up or logged in; no command; no “automatic checks can’t find” text', () => {
    for (const report of [full(), stopped, byChoice]) {
      const box = coverageBox(report);
      expect(box).toContain('Full check (AI)');
      expect(box).toContain('ShipCheck tried to use your app like a new visitor');
      expect(box).not.toMatch(/ShipCheck (signed up|logged in|used your app)/);
      expect(box).toContain('This is not a guarantee');
      expect(box).not.toContain('npx ');
      expect(box).not.toContain('Automatic checks can’t find');
    }
  });

  it('automatic checks only: plain reason, the command for the full check and the key how-to', () => {
    const box = coverageBox(noAi);
    expect(box).toContain('Automatic checks only (no AI)');
    expect(box.match(/Not tested: this needs the full check/g)).toHaveLength(5);
    expect(box).not.toContain('--no-ai');
    expect(box).toContain('<code>npx @anjalipanwar/shipcheck https://myapp.example.com/</code>');
    expect(box).toContain('#get-a-free-ai-key');
    expect(box).toContain('That’s why a full check often finds more');
  });
});

describe('severity chips and legend', () => {
  it('correct plurals: “1 Blocker”, “2 Blockers”; the describing words stay as they are', () => {
    expect(severityCount('blocker', 0)).toBe('0 Blockers');
    expect(severityCount('blocker', 1)).toBe('1 Blocker');
    expect(severityCount('blocker', 2)).toBe('2 Blockers');
    expect(severityCount('major', 4)).toBe('4 Major');
    expect(countsLine({ blocker: 2, major: 1, minor: 7, info: 0 })).toBe(
      '2 Blockers · 1 Major · 7 Minor · 0 Info',
    );
  });
  it('the one-line legend is in the HTML, the Markdown and the step summary', () => {
    const legend =
      'Blocker = stops people using your app · Major = breaks or confuses many people · Minor = polish';
    expect(SEVERITY_LEGEND).toBe(legend);
    for (const text of [renderHtml(noAi), renderMarkdown(noAi), renderStepSummary(noAi)]) {
      expect(text).toContain(legend);
    }
  });
  it('“not ready” says “or is a security risk”', () => {
    const text = verdictSummary(makeReport([finding({ severity: 'blocker' })], { meta: fullMeta }));
    expect(text).toContain('would stop a new user or is a security risk');
  });
});

describe('the box in report.md, the step summary and the terminal', () => {
  it('snapshot: Markdown, both modes', () => {
    expect(coverageMarkdown(noAi, '##').join('\n')).toMatchSnapshot();
    expect(coverageMarkdown(stopped, '##').join('\n')).toMatchSnapshot();
  });

  it('report.md and the step summary carry the same words as the HTML', () => {
    for (const text of [renderMarkdown(noAi), renderStepSummary(noAi)]) {
      expect(text).toContain('What this report covers');
      expect(text).toContain('**Automatic checks only (no AI)** — ShipCheck loaded your pages');
      expect(text).toContain('**Using your app like a visitor (full check only)**');
      expect(text).toContain('| Log-in | ○ Not tested: this needs the full check |');
      expect(text).toContain('| SEO | ⚠ 1 problem (worst: Minor) |');
      expect(text).toContain('| Hidden errors | ✓ No problems found |');
      expect(text).toContain('Automatic checks can’t find problems');
    }
    for (const text of [renderMarkdown(stopped), renderStepSummary(stopped)]) {
      expect(text).toContain('ShipCheck tried to use your app like a new visitor');
      expect(text).not.toContain('Automatic checks can’t find problems');
    }
  });

  it('every row of every format uses the same state text', () => {
    const html = coverageBox(stopped);
    const markdown = coverageMarkdown(stopped, '##').join('\n');
    for (const group of coverageView(stopped).groups) {
      for (const row of group.rows) {
        expect(html).toContain(row.text.replace(/’/g, '’'));
        expect(markdown).toContain(`${row.icon} ${row.text}`);
      }
    }
  });

  it('one terminal line with the same labels', () => {
    expect(coverageLine(noAi)).toBe(
      'What this report covers: Automatic checks only (no AI) — 5 areas without problems; problems in: SEO; not tested: Sign-up, Log-in, Main feature, Forms (including wrong or missing input), Using it on a phone.',
    );
    expect(coverageLine(full({}, []))).toBe(
      'What this report covers: Full check (AI) — 11 areas without problems.',
    );
  });

  it('nothing to fix: the “Fix these first” text promises only what the verdict does', () => {
    const promise = 'no problems that need fixing before launch';
    const passedNoAi = makeReport();
    const partly = makeReport([], {
      meta: { ...noAi.meta, mode: 'full', model: 'm', llmCalls: 5 },
      coverage: coverageFor('full', { core: 'stopped early. Try again.' }),
    });
    expect(partly.verdict).toBe('partly-tested');
    for (const report of [passedNoAi, partly]) {
      expect(renderHtml(report)).not.toContain(promise);
      expect(renderMarkdown(report)).not.toContain(promise);
    }
    expect(renderHtml(partly)).toContain('Nothing urgent in the parts ShipCheck could test.');
    expect(
      renderHtml(makeReport([], { meta: { ...noAi.meta, mode: 'full', model: 'm', llmCalls: 5 } })),
    ).toContain(promise); // "ready" keeps it
  });

  it('the full-check command quotes an address a shell could misread', () => {
    expect(fullCheckCommand('https://myapp.lovable.app/')).toBe(
      'npx @anjalipanwar/shipcheck https://myapp.lovable.app/',
    );
    expect(fullCheckCommand('https://a.app/?x=1&y=2')).toBe(
      'npx @anjalipanwar/shipcheck "https://a.app/?x=1&y=2"',
    );
    expect(fullCheckCommand('https://a.app/$x')).toBe(
      'npx @anjalipanwar/shipcheck "https://a.app/\\$x"',
    );
  });

  it('“Ready to launch” never appears in any output of a --no-ai report', () => {
    for (const report of [makeReport(), noAi]) {
      for (const text of [
        renderHtml(report),
        renderMarkdown(report),
        renderStepSummary(report),
        coverageLine(report),
        VERDICT_LABEL[report.verdict],
      ]) {
        expect(text).not.toContain(VERDICT_LABEL.ready);
      }
    }
  });
});
