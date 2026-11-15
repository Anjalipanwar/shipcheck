import type { Page } from 'playwright';
import { z } from 'zod';
import { XPATH_OF_SOURCE } from '../browser/element.js';
import { makeFinding, type Finding } from '../report/schema.js';
import type { CheckResult } from './types.js';

/**
 * Phone layout checks (SPEC §6.1 flow 6, §8 step 5). They only read the page; nothing is clicked
 * here. Run on the phone context only, so a desktop layout is never judged by phone rules.
 */

/** WCAG 2.2 success criterion 2.5.8 (Target Size, Minimum): 24 × 24 CSS pixels. */
export const MIN_TARGET_PX = 24;
const MAX_EXAMPLES = 5;

export interface Control {
  /** Plain description: the visible text, label, or kind of element. */
  label: string;
  /** Short technical hint for the fix prompt, e.g. `button.menu-toggle`. */
  tag: string;
  width: number;
  height: number;
}

export interface Covered {
  control: Control;
  /** Plain description of what lies on top, e.g. `We use cookies… (div.cookie-bar)`. */
  by: string;
  /**
   * Exact address (`xpath=…`) of the fixed or sticky box the covering element belongs to — a
   * banner or pop-up that may be closable. Null when the cover is part of the normal layout.
   */
  cover: string | null;
  /** The start of that box's text, to tell a cookie banner from another banner. */
  coverText: string;
  /**
   * Set after ShipCheck closed the cover with a safe button (see mobile-banner.ts) and the
   * control could then be tapped. Absent: the control stayed covered or nothing was tried.
   */
  closedWith?: string;
}

export interface LayoutFacts {
  url: string;
  screenWidth: number;
  pageWidth: number;
  /** The element that makes the page too wide, if the page scrolls sideways. `label` is its tag name. */
  widest: { tag: string; label: string; width: number } | null;
  /** Buttons and menu links that sit (mostly) outside the screen. */
  cutOff: Control[];
  /** Buttons and menu links whose middle is covered by another element. */
  covered: Covered[];
  /** Targets under 24 × 24 px that are also too close to another target (WCAG 2.5.8). */
  tooSmall: Control[];
  /** How many buttons and menu links were looked at. */
  controls: number;
}

/*
 * Runs inside the tested page (plain text on purpose, see collect.ts). "Controls" are the things
 * a visitor is meant to tap: buttons, button-styled links and links in the header or main menu.
 * Ordinary links inside text are left out (WCAG 2.5.8 exempts them as well).
 */
const LAYOUT_SCRIPT = `(() => {
  ${XPATH_OF_SOURCE}
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const tagOf = (el) => {
    const cls = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean)[0];
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls ? '.' + cls : '');
  };
  const labelOf = (el) => clean(el.getAttribute('aria-label') || el.innerText || el.value ||
    el.getAttribute('title') || '') || tagOf(el);
  const shown = (el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' &&
      style.display !== 'none' && Number(style.opacity) > 0 &&
      !el.closest('[aria-hidden="true"], [inert]');
  };
  // An element inside a closed drawer (a fixed/absolute panel parked off-screen) is hidden on
  // purpose, not cut off.
  const parkedOffscreen = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position !== 'fixed' && position !== 'absolute') continue;
      const box = node.getBoundingClientRect();
      if (box.right <= 0 || box.left >= vw) return true;
    }
    return false;
  };
  // Inside a box that scrolls sideways on its own (a carousel), off-screen items are expected.
  const inScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth) {
        return true;
      }
    }
    return false;
  };
  const isButtonLike = (el) => el.getAttribute('role') === 'button' ||
    /(^|[\\s_-])(btn|button|cta)([\\s_-]|$)/i.test(el.getAttribute('class') || '');
  const controls = [...document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], a[href]'
  )].filter((el) => {
    if (!shown(el)) return false;
    if (el.tagName !== 'A') return true;
    return isButtonLike(el) || el.closest('header, nav, [role="navigation"], [role="banner"]') !== null;
  });
  const describe = (el) => {
    const box = el.getBoundingClientRect();
    return { label: labelOf(el), tag: tagOf(el), width: Math.round(box.width), height: Math.round(box.height) };
  };

  const cutOff = controls.filter((el) => {
    if (parkedOffscreen(el) || inScroller(el)) return false;
    const box = el.getBoundingClientRect();
    const inside = Math.max(0, Math.min(box.right, vw) - Math.max(box.left, 0));
    return inside < box.width / 2;
  });

  const covered = [];
  for (const el of controls) {
    if (cutOff.includes(el)) continue;
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || x >= vw || y < 0 || y >= vh) continue; // only what is on screen at load
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit) || hit.contains(el)) continue;
    // A label wrapping or pointing at the control taps the control itself.
    if (hit.closest('label') && hit.closest('label').contains(el)) continue;
    // The outermost fixed or sticky box the cover sits in: a banner or pop-up that might be
    // closable. It must not contain the covered control (an app whose whole shell is fixed is
    // not a banner).
    let overlay = null;
    for (let node = hit; node && node !== document.body; node = node.parentElement) {
      if (node.contains(el)) break;
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') overlay = node;
    }
    covered.push({ control: describe(el), by: labelOf(hit).slice(0, 40) + ' (' + tagOf(hit) + ')',
      cover: overlay ? 'xpath=' + xpathOf(overlay) : null,
      coverText: overlay ? (overlay.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '' });
  }

  const boxes = controls.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX,
      bottom: r.bottom + scrollY, width: r.width, height: r.height };
  });
  const small = (b) => b.width < ${MIN_TARGET_PX} || b.height < ${MIN_TARGET_PX};
  const center = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
  const distanceToBox = (p, b) => Math.hypot(
    Math.max(b.left - p.x, 0, p.x - b.right), Math.max(b.top - p.y, 0, p.y - b.bottom));
  const radius = ${MIN_TARGET_PX} / 2;
  // WCAG 2.5.8 spacing exception: an undersized target passes if a 24 px circle on its centre
  // touches no other target and no other undersized target's circle.
  const tooSmall = boxes.filter((b) => {
    if (!small(b)) return false;
    const c = center(b);
    return boxes.some((o) => {
      if (o === b || o.el.contains(b.el) || b.el.contains(o.el)) return false;
      if (distanceToBox(c, o) < radius) return true;
      if (!small(o)) return false;
      const d = center(o);
      return Math.hypot(c.x - d.x, c.y - d.y) < radius * 2;
    });
  }).map((b) => describe(b.el));

  const pageWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  let widest = null;
  if (pageWidth > vw + 1) {
    // The outermost element that sticks out while its parent still fits is the cause.
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.right <= vw + 1 || !shown(el)) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent.getBoundingClientRect().right > vw + 1) continue;
      if (!widest || box.width > widest.width) {
        widest = { tag: tagOf(el), label: el.tagName.toLowerCase(), width: Math.round(box.width) };
      }
    }
  }

  return {
    url: location.href, screenWidth: vw, pageWidth, widest,
    cutOff: cutOff.map(describe), covered, tooSmall, controls: controls.length,
  };
})()`;

const ControlSchema = z.object({
  label: z.string(),
  tag: z.string(),
  width: z.number(),
  height: z.number(),
});
const LayoutFactsSchema = z.object({
  url: z.string(),
  screenWidth: z.number(),
  pageWidth: z.number(),
  widest: z.object({ tag: z.string(), label: z.string(), width: z.number() }).nullable(),
  cutOff: z.array(ControlSchema),
  covered: z.array(
    z.object({
      control: ControlSchema,
      by: z.string(),
      cover: z.string().nullable(),
      coverText: z.string(),
    }),
  ),
  tooSmall: z.array(ControlSchema),
  controls: z.number(),
});

export async function collectLayoutFacts(page: Page): Promise<LayoutFacts> {
  return LayoutFactsSchema.parse(await page.evaluate(LAYOUT_SCRIPT));
}

/** A layout fact together with the screenshot taken of that page on the phone. */
export interface CheckedPage {
  facts: LayoutFacts;
  screenshot?: string;
}

const path = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
};

const named = (control: Pick<Control, 'label'>): string => `“${control.label}”`;

/** Words that mark a banner as a cookie or consent banner (English and German). */
export function isCookieBanner(text: string): boolean {
  return /cookie|consent|gdpr|dsgvo|datenschutz|einwilligung|tracking/i.test(text);
}

/** "a table", "an image"… — what a visitor would call the element that is too wide. */
function kindOf(tagName: string): string {
  if (tagName === 'table') return 'a table';
  if (['img', 'picture', 'svg', 'canvas'].includes(tagName)) return 'an image';
  if (tagName === 'video') return 'a video';
  if (tagName === 'iframe') return 'an embedded frame';
  if (tagName === 'pre' || tagName === 'code') return 'a block of code';
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return 'a form field';
  return 'a section of the page';
}

function screenshotsOf(pages: CheckedPage[]): string[] {
  return pages.flatMap((p) => (p.screenshot ? [p.screenshot] : [])).slice(0, 3);
}

const PHONE_STEPS = (url: string): string[] => [
  `Open ${url} on a phone (or in Chrome: right-click → Inspect → the phone icon, choose “iPhone 12 Pro” or similar).`,
];

/** Turns the facts of all checked pages into findings. Pure, so it is unit-tested. */
export function judgeLayout(pages: CheckedPage[]): CheckResult {
  const findings: Finding[] = [];
  const passed: string[] = [];
  if (pages.length === 0) {
    return { findings, passed, notTested: ['Phone layout — no page could be opened on a phone'] };
  }

  const sideways = pages.filter((p) => p.facts.pageWidth > p.facts.screenWidth + 1);
  const first = sideways[0];
  if (first) {
    const { facts } = first;
    findings.push(
      makeFinding({
        rule: 'mobile/sideways-scroll',
        title:
          sideways.length === 1
            ? 'A page scrolls sideways on a phone'
            : `${sideways.length} pages scroll sideways on a phone`,
        severity: 'minor',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `On a phone-sized screen (${facts.screenWidth} px wide), ${sideways.length === 1 ? 'the page' : 'these pages'} ${sideways.length === 1 ? 'is' : 'are'} wider than the screen, so visitors can drag ${sideways.length === 1 ? 'it' : 'them'} sideways and the layout wobbles.${facts.widest ? ` The cause on ${path(facts.url)} is ${kindOf(facts.widest.label)} that is ${facts.widest.width} px wide.` : ''}`,
        whyItMatters:
          'Most visitors come on a phone. A page that slides sideways feels broken and makes text harder to read.',
        stepsToReproduce: [...PHONE_STEPS(facts.url), 'Swipe left: the page moves sideways.'],
        evidence: {
          screenshots: screenshotsOf(sideways),
          logs: sideways
            .slice(0, MAX_EXAMPLES)
            .map(
              (p) =>
                `${p.facts.url}: page is ${p.facts.pageWidth} px wide on a ${p.facts.screenWidth} px screen${p.facts.widest ? ` — widest part: ${p.facts.widest.tag}, ${p.facts.widest.width} px` : ''}`,
            ),
          url: facts.url,
        },
        fixPrompt: `On a phone (390 px wide), these pages of my app are wider than the screen and scroll sideways. Please make them fit: let wide elements shrink or wrap, or put wide tables in a container with "overflow-x: auto". Do not hide the overflow on <body>.\n${sideways
          .slice(0, MAX_EXAMPLES)
          .map(
            (p) =>
              `- ${p.facts.url}${p.facts.widest ? ` (cause: ${p.facts.widest.tag}, ${p.facts.widest.width} px wide)` : ''}`,
          )
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  } else {
    passed.push(
      `${pages.length === 1 ? 'The page fits' : `All ${pages.length} pages fit`} a phone screen without scrolling sideways`,
    );
  }

  const cut = pages.filter((p) => p.facts.cutOff.length > 0);
  const firstCut = cut[0];
  if (firstCut) {
    const examples = cut.flatMap((p) => p.facts.cutOff.map((c) => ({ c, url: p.facts.url })));
    const lead = examples[0] as { c: Control; url: string };
    findings.push(
      makeFinding({
        rule: 'mobile/button-cut-off',
        title:
          examples.length === 1
            ? `The ${named(lead.c)} button is cut off on a phone`
            : `${examples.length} buttons or menu links are cut off on a phone`,
        severity: 'major',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `On a phone-sized screen, ${examples.length === 1 ? 'a button sits' : 'buttons sit'} mostly outside the visible area, so visitors may never see ${examples.length === 1 ? 'it' : 'them'}.`,
        whyItMatters:
          'A button that is off the screen can’t be found or tapped; if it is the main action, phone visitors are stuck.',
        stepsToReproduce: [
          ...PHONE_STEPS(lead.url),
          `Look for ${named(lead.c)}: it is cut off at the edge of the screen.`,
        ],
        evidence: {
          screenshots: screenshotsOf(cut),
          logs: examples
            .slice(0, MAX_EXAMPLES)
            .map((e) => `${e.url}: ${named(e.c)} (${e.c.tag}) is mostly outside the screen`),
          url: firstCut.facts.url,
        },
        fixPrompt: `On a phone (390 px wide), these buttons in my app are pushed outside the screen. Please change the layout so they stay fully visible on narrow screens (let rows wrap, use flex-wrap or stack items vertically below 768 px):\n${examples
          .slice(0, MAX_EXAMPLES)
          .map((e) => `- ${named(e.c)} (${e.c.tag}) on ${e.url}`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  // A cover ShipCheck closed with a safe button (and the button could then be tapped) is a
  // nuisance, not a dead end: Minor. A cover that could not be closed, or a button still covered
  // afterwards: Major.
  const stuck = (p: CheckedPage) => p.facts.covered.filter((c) => c.closedWith === undefined);
  const freed = (p: CheckedPage) => p.facts.covered.filter((c) => c.closedWith !== undefined);
  const coveredPages = pages.filter((p) => stuck(p).length > 0);
  const firstCovered = coveredPages[0];
  if (firstCovered) {
    const examples = coveredPages.flatMap((p) => stuck(p).map((c) => ({ ...c, url: p.facts.url })));
    const lead = examples[0] as Covered & { url: string };
    findings.push(
      makeFinding({
        rule: 'mobile/button-covered',
        title:
          examples.length === 1
            ? `The ${named(lead.control)} button is covered by something else on a phone`
            : `${examples.length} buttons or menu links are covered by other elements on a phone`,
        severity: 'major',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `On a phone-sized screen, another element lies on top of ${examples.length === 1 ? 'a button' : 'buttons'}, so a tap hits the wrong thing.`,
        whyItMatters:
          'Visitors tap the button and nothing happens, or something else opens instead.',
        stepsToReproduce: [
          ...PHONE_STEPS(lead.url),
          `Try to tap ${named(lead.control)}: ${lead.by} is in the way.`,
        ],
        evidence: {
          screenshots: screenshotsOf(coveredPages),
          logs: examples
            .slice(0, MAX_EXAMPLES)
            .map((e) => `${e.url}: ${named(e.control)} (${e.control.tag}) is covered by ${e.by}`),
          url: firstCovered.facts.url,
        },
        fixPrompt: `On a phone (390 px wide), these buttons in my app are covered by other elements, so taps don't reach them. Please fix the layout (check overlapping positioned elements, z-index and fixed banners) so each button is fully tappable:\n${examples
          .slice(0, MAX_EXAMPLES)
          .map((e) => `- ${named(e.control)} (${e.control.tag}) on ${e.url}, covered by ${e.by}`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const freedPages = pages.filter((p) => freed(p).length > 0);
  const firstFreed = freedPages[0];
  if (firstFreed) {
    const examples = freedPages.flatMap((p) => freed(p).map((c) => ({ ...c, url: p.facts.url })));
    const lead = examples[0] as Covered & { url: string; closedWith: string };
    const banner = examples.every((e) => isCookieBanner(e.coverText)) ? 'cookie banner' : 'banner';
    const one = examples.length === 1;
    findings.push(
      makeFinding({
        rule: 'mobile/button-covered-until-closed',
        title: one
          ? `A ${banner} covers the ${named(lead.control)} button until it’s closed`
          : `A ${banner} covers ${examples.length} buttons until it’s closed`,
        severity: 'minor',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `On a phone-sized screen, a ${banner} lies on top of ${one ? `the ${named(lead.control)} button` : 'some buttons'} when the page opens. ShipCheck closed it with ${named({ label: lead.closedWith })}, and then ${one ? 'the button' : 'the buttons'} could be tapped.`,
        whyItMatters:
          'Visitors have to close the banner before they can tap the button. On a small screen that is easy to miss, and some visitors give up instead.',
        stepsToReproduce: [
          ...PHONE_STEPS(lead.url),
          `The ${banner} covers ${named(lead.control)}.`,
          `Tap ${named({ label: lead.closedWith })}: the banner closes and ${named(lead.control)} can be tapped.`,
        ],
        evidence: {
          screenshots: screenshotsOf(freedPages),
          logs: examples
            .slice(0, MAX_EXAMPLES)
            .map(
              (e) =>
                `${e.url}: ${named(e.control)} (${e.control.tag}) is covered by ${e.by} until “${e.closedWith}” is tapped`,
            ),
          url: firstFreed.facts.url,
        },
        fixPrompt: `On a phone (390 px wide), a ${banner} in my app covers these buttons until the visitor closes it. Please make the banner take less room on small screens (for example a slim bar at the bottom of the screen, with matching bottom padding on the page) so it never sits on top of a main button:\n${examples
          .slice(0, MAX_EXAMPLES)
          .map((e) => `- ${named(e.control)} (${e.control.tag}) on ${e.url}, covered by ${e.by}`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const smallPages = pages.filter((p) => p.facts.tooSmall.length > 0);
  const firstSmall = smallPages[0];
  if (firstSmall) {
    const examples = smallPages.flatMap((p) =>
      p.facts.tooSmall.map((c) => ({ c, url: p.facts.url })),
    );
    const lead = examples[0] as { c: Control; url: string };
    findings.push(
      makeFinding({
        rule: 'mobile/small-tap-targets',
        title: 'Some buttons and links are too small to tap easily on a phone',
        severity: 'minor',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `${examples.length} ${examples.length === 1 ? 'button or link is' : 'buttons or links are'} smaller than ${MIN_TARGET_PX} × ${MIN_TARGET_PX} px and close to other ones, so a finger easily hits the wrong one.`,
        whyItMatters:
          'Mis-taps are frustrating, especially for people with larger fingers or shaky hands. This is also an accessibility requirement (WCAG 2.5.8).',
        stepsToReproduce: [
          ...PHONE_STEPS(lead.url),
          `Try to tap ${named(lead.c)} with your thumb.`,
        ],
        evidence: {
          screenshots: screenshotsOf(smallPages),
          logs: examples
            .slice(0, MAX_EXAMPLES)
            .map((e) => `${e.url}: ${named(e.c)} (${e.c.tag}) is ${e.c.width} × ${e.c.height} px`),
          url: firstSmall.facts.url,
        },
        fixPrompt: `On a phone, these buttons and links in my app are smaller than 24 × 24 px and too close together. Please give each one at least 24 × 24 px (44 × 44 px is better), for example with padding, or more space between them:\n${examples
          .slice(0, MAX_EXAMPLES)
          .map((e) => `- ${named(e.c)} (${e.c.tag}, ${e.c.width} × ${e.c.height} px) on ${e.url}`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  } else if (pages.some((p) => p.facts.controls > 0)) {
    passed.push('Buttons and menu links are big enough to tap on a phone');
  }
  if (!firstCut && !firstCovered && !firstFreed && pages.some((p) => p.facts.controls > 0)) {
    passed.push('No buttons are cut off or covered on a phone');
  }
  return { findings, passed, notTested: [] };
}
