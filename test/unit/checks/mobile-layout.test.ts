import { describe, expect, it } from 'vitest';
import {
  judgeLayout,
  type CheckedPage,
  type Control,
  type LayoutFacts,
} from '../../../src/checks/mobile-layout.js';

const fits = (url = 'https://app.example.com/', extra: Partial<LayoutFacts> = {}): LayoutFacts => ({
  url,
  screenWidth: 390,
  pageWidth: 390,
  widest: null,
  cutOff: [],
  covered: [],
  tooSmall: [],
  controls: 6,
  ...extra,
});
const page = (facts: LayoutFacts, screenshot?: string): CheckedPage => ({
  facts,
  ...(screenshot ? { screenshot } : {}),
});
const covered = (control: Control, by: string, cover: string | null = null, coverText = '') => ({
  control,
  by,
  cover,
  coverText,
});
const cookieBar = (control: Control) =>
  covered(
    control,
    'We use cookies (div.cookie-bar)',
    'xpath=/html[1]/body[1]/div[1]',
    'We use cookies to improve your visit. Reject all Accept all',
  );
const button = (label: string, width = 80, height = 40): Control => ({
  label,
  tag: 'button.cta',
  width,
  height,
});

describe('judgeLayout', () => {
  it('pages that fit → no findings, and what worked is listed', () => {
    const result = judgeLayout([page(fits()), page(fits('https://app.example.com/about'))]);
    expect(result.findings).toEqual([]);
    expect(result.passed).toEqual([
      'All 2 pages fit a phone screen without scrolling sideways',
      'Buttons and menu links are big enough to tap on a phone',
      'No buttons are cut off or covered on a phone',
    ]);
  });

  it('a page wider than the screen → Minor “scrolls sideways”, naming the cause (planted bug #8)', () => {
    const result = judgeLayout([
      page(fits()),
      page(
        fits('https://app.example.com/features.html', {
          pageWidth: 916,
          widest: { tag: 'table.plans', label: 'table', width: 900 },
        }),
        'screenshots/05-mobile-layout-features-html.jpg',
      ),
    ]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding).toMatchObject({
      rule: 'mobile/sideways-scroll',
      title: 'A page scrolls sideways on a phone',
      severity: 'minor',
      category: 'mobile',
      flow: 'mobile',
      device: 'mobile',
      confidence: 'verified',
    });
    expect(finding?.evidence.screenshots).toEqual([
      'screenshots/05-mobile-layout-features-html.jpg',
    ]);
    expect(finding?.evidence.logs).toEqual([
      'https://app.example.com/features.html: page is 916 px wide on a 390 px screen — widest part: table.plans, 900 px',
    ]);
    expect(finding?.fixPrompt).toContain('overflow-x: auto');
    expect(finding?.whatHappened).toContain(
      'The cause on /features.html is a table that is 900 px wide.',
    );
  });

  it('one pixel of rounding is not “sideways”', () => {
    expect(judgeLayout([page(fits(undefined, { pageWidth: 391 }))]).findings).toEqual([]);
  });

  it('a button pushed off the screen → Major', () => {
    const result = judgeLayout([page(fits(undefined, { cutOff: [button('Sign up')] }))]);
    expect(result.findings.map((f) => [f.rule, f.severity, f.title])).toEqual([
      ['mobile/button-cut-off', 'major', 'The “Sign up” button is cut off on a phone'],
    ]);
  });

  it('a button under another element → Major, naming what covers it', () => {
    const result = judgeLayout([
      page(fits(undefined, { covered: [covered(button('Buy'), 'Chat with us (div.chat)')] })),
    ]);
    expect(result.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['mobile/button-covered', 'major'],
    ]);
    expect(result.findings[0]?.evidence.logs?.[0]).toContain('covered by Chat with us (div.chat)');
  });

  // Owner decision 2026-11-15: try to close a covering banner with a safe button first.
  it('a cookie banner ShipCheck could close, button reachable afterwards → Minor with a note', () => {
    const result = judgeLayout([
      page(
        fits(undefined, {
          covered: [{ ...cookieBar(button('Sign up')), closedWith: 'Reject all' }],
        }),
        'screenshots/03-mobile-layout.jpg',
      ),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: 'mobile/button-covered-until-closed',
      title: 'A cookie banner covers the “Sign up” button until it’s closed',
      severity: 'minor',
      device: 'mobile',
      evidence: { screenshots: ['screenshots/03-mobile-layout.jpg'] },
    });
    expect(result.findings[0]?.whatHappened).toContain('ShipCheck closed it with “Reject all”');
    expect(result.findings[0]?.stepsToReproduce.at(-1)).toBe(
      'Tap “Reject all”: the banner closes and “Sign up” can be tapped.',
    );
    expect(result.passed).not.toContain('No buttons are cut off or covered on a phone');
  });

  it('a banner that could not be closed, or a button still covered after closing → Major', () => {
    // No `closedWith`: either nothing safe to tap ("Accept all" only), or the button stayed covered.
    const result = judgeLayout([
      page(fits(undefined, { covered: [cookieBar(button('Sign up'))] })),
    ]);
    expect(result.findings.map((f) => [f.rule, f.severity, f.title])).toEqual([
      [
        'mobile/button-covered',
        'major',
        'The “Sign up” button is covered by something else on a phone',
      ],
    ]);
  });

  it('both outcomes on one run → one Major and one Minor finding, each listing its own buttons', () => {
    const result = judgeLayout([
      page(
        fits(undefined, {
          covered: [
            { ...cookieBar(button('Sign up')), closedWith: 'Close' },
            covered(button('Buy'), 'Chat with us (div.chat)', 'xpath=/html[1]/body[1]/div[2]'),
          ],
        }),
      ),
    ]);
    expect(result.findings.map((f) => [f.rule, f.severity, f.evidence.logs])).toEqual([
      [
        'mobile/button-covered',
        'major',
        ['https://app.example.com/: “Buy” (button.cta) is covered by Chat with us (div.chat)'],
      ],
      [
        'mobile/button-covered-until-closed',
        'minor',
        [
          'https://app.example.com/: “Sign up” (button.cta) is covered by We use cookies (div.cookie-bar) until “Close” is tapped',
        ],
      ],
    ]);
  });

  it('a closed banner without cookie wording is just “a banner”', () => {
    const result = judgeLayout([
      page(
        fits(undefined, {
          covered: [
            {
              ...covered(button('Buy'), 'Sale (div.promo)', 'xpath=/x', 'Summer sale!'),
              closedWith: '×',
            },
          ],
        }),
      ),
    ]);
    expect(result.findings[0]?.title).toBe('A banner covers the “Buy” button until it’s closed');
  });

  it('crowded small targets → one Minor finding with sizes', () => {
    const result = judgeLayout([
      page(fits(undefined, { tooSmall: [button('×', 16, 16), button('Next', 30, 18)] })),
    ]);
    expect(result.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['mobile/small-tap-targets', 'minor'],
    ]);
    expect(result.findings[0]?.evidence.logs).toEqual([
      'https://app.example.com/: “×” (button.cta) is 16 × 16 px',
      'https://app.example.com/: “Next” (button.cta) is 30 × 18 px',
    ]);
  });

  it('no page could be opened → “not tested”, never a finding', () => {
    expect(judgeLayout([])).toEqual({
      findings: [],
      passed: [],
      notTested: ['Phone layout — no page could be opened on a phone'],
    });
  });

  it('findings never use developer jargon in the title', () => {
    const result = judgeLayout([
      page(
        fits(undefined, {
          pageWidth: 900,
          cutOff: [button('A')],
          covered: [covered(button('B'), 'x'), { ...cookieBar(button('D')), closedWith: 'Reject' }],
          tooSmall: [button('C', 10, 10)],
        }),
      ),
    ]);
    expect(result.findings).toHaveLength(5);
    for (const finding of result.findings) {
      expect(finding.title).not.toMatch(/\b(DOM|selector|viewport|CSS|px|overflow)\b/i);
    }
  });
});
