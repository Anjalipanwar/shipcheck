import type { Page } from 'playwright';
import { z } from 'zod';
import type { DeviceName } from '../browser/devices.js';
import { readElementFacts, XPATH_OF_SOURCE } from '../browser/element.js';
import type { Evidence } from '../browser/evidence.js';
import { judgeAction } from '../browser/guard.js';
import { collectLayoutFacts, type Covered, type LayoutFacts } from './mobile-layout.js';

/**
 * Covered buttons on a phone (owner decision 2026-11-15): when a banner or pop-up lies on top of
 * a button, ShipCheck first tries to close it — with a safe choice only ("Close", "Reject",
 * "Only necessary"), never one that gives consent ("Accept all") — and through the same guard as
 * every other tap. If the button can be tapped afterwards, the problem is Minor; otherwise Major.
 */

const SETTLE_MS = 700;
/** At most this many banners are closed per page. */
const MAX_COVERS = 2;

const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s.!:,;–—-]+|[\s.!:,;–—-]+$/g, '')
    .trim();

/** Giving consent, in any wording: never tapped, even when the same button also says "close". */
const CONSENT =
  /accept|agree|allow|consent|got it|okay|\bok\b|continue|i understand|akzeptier|zustimm|stimme|erlaub|einverstanden|annehmen|verstanden|weiter/i;

/**
 * Safe ways to close a banner, best first: refusing (which tells a consent banner "no") ranks
 * above a plain "close". Whole-label matches only, so "Close account" never qualifies.
 */
const SAFE: readonly [kind: SafeDismiss, pattern: RegExp][] = [
  [
    'reject',
    /^(reject|reject all|reject cookies|reject all cookies|decline|decline all|decline cookies|deny|deny all|refuse|refuse all|ablehnen|alle ablehnen|cookies ablehnen)$/,
  ],
  [
    'necessary',
    /^((use )?(only|strictly) (necessary|essential|required)( cookies)?( only)?|(use )?(necessary|essential|required)( cookies)? only|nur (notwendige|erforderliche|essenzielle|technisch notwendige)( cookies)?( verwenden| zulassen)?)$/,
  ],
  [
    'close',
    /^(close|dismiss|hide|×|✕|✖|x|schließen|schliessen|ausblenden)( (the |this )?(cookie |cookies |consent |privacy )?(banner|notice|dialog|pop-?up|message|bar|window|hinweis|meldung|fenster))?$/,
  ],
];

export type SafeDismiss = 'reject' | 'necessary' | 'close';

/**
 * The safe kind of a banner button, judged from all its names (visible text, aria-label,
 * title, value). Null if any name gives consent or none is on the safe list.
 */
export function safeDismissKind(names: readonly string[]): SafeDismiss | null {
  const cleaned = names.map(normal).filter(Boolean);
  if (cleaned.length === 0 || cleaned.some((name) => CONSENT.test(name))) return null;
  for (const [kind, pattern] of SAFE) {
    if (cleaned.some((name) => pattern.test(name))) return kind;
  }
  return null;
}

const RANK: Record<SafeDismiss, number> = { reject: 0, necessary: 1, close: 2 };

/**
 * Buttons inside the covering box. Links are left out: following one could leave the page.
 * Addresses are positional and can go stale (a banner removed, a widget added), so the box is
 * re-checked first: it must still be fixed or sticky and still start with the recorded text.
 * Otherwise nothing is returned and nothing is tapped.
 */
const FIND_BUTTONS = `((cover, expectedText) => {
  ${XPATH_OF_SOURCE}
  const found = document.evaluate(cover.replace(/^xpath=/, ''), document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!found || found.nodeType !== 1) return [];
  const position = getComputedStyle(found).position;
  if (position !== 'fixed' && position !== 'sticky') return [];
  const text = (found.innerText || '').replace(/\\s+/g, ' ').trim();
  if (!expectedText || !text.startsWith(expectedText.slice(0, 60))) return [];
  const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  return [...found.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')]
    .filter(shown)
    .map((el) => ({
      selector: 'xpath=' + xpathOf(el),
      names: [clean(el.innerText), clean(el.getAttribute('aria-label')), clean(el.getAttribute('title')),
        el.tagName === 'INPUT' ? clean(el.value) : ''].filter(Boolean),
    }));
})`;

const ButtonsSchema = z.array(z.object({ selector: z.string(), names: z.array(z.string()) }));

export interface DismissOptions {
  device: DeviceName;
  evidence: Evidence;
  /** Test-only switch, as in flows. It turns off the guard, never the safe-choice list. */
  guardEnabled?: boolean;
}

const key = (c: Covered): string => `${c.control.tag}|${c.control.label}`;
const withoutHash = (url: string): string => url.split('#')[0] ?? url;

type Attempt = { tapped: string } | { tapped: null; leftPage: boolean };

/** One safe, guarded tap inside one banner. */
async function closeOne(page: Page, cover: Covered, options: DismissOptions): Promise<Attempt> {
  const none = { tapped: null, leftPage: false } as const;
  if (!cover.cover) return none;
  const buttons = ButtonsSchema.parse(
    await page.evaluate(
      `${FIND_BUTTONS}(${JSON.stringify(cover.cover)}, ${JSON.stringify(cover.coverText)})`,
    ),
  );
  const choice = buttons
    .map((b) => ({ ...b, kind: safeDismissKind(b.names) }))
    .filter((b): b is typeof b & { kind: SafeDismiss } => b.kind !== null)
    .sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];
  if (!choice) return none; // nothing safe to tap: the banner stays, the button stays covered

  const label = choice.names[0] ?? choice.kind;
  const startUrl = page.url();
  const logged = {
    device: options.device,
    flow: 'mobile',
    intent: `Close the banner covering a button (“${label}”)`,
    action: 'click',
    locator: choice.selector,
    url: startUrl,
  };
  const verdict =
    options.guardEnabled === false
      ? { allowed: true as const }
      : judgeAction(
          { selector: choice.selector, description: `Banner button “${label}”`, method: 'click' },
          await readElementFacts(page, choice.selector),
        );
  if (!verdict.allowed) {
    options.evidence.logAction({ ...logged, result: 'blocked', detail: verdict.reason });
    return none;
  }
  let ok = true;
  try {
    await page.locator(choice.selector).click({ timeout: 3000 });
  } catch {
    ok = false;
  }
  await page.waitForTimeout(SETTLE_MS);
  options.evidence.logAction({ ...logged, result: ok ? 'ok' : 'failed' });
  if (withoutHash(page.url()) !== withoutHash(startUrl)) {
    // The "close" button left the page. Go back, so later checks run where they expect to.
    await page.goto(startUrl).catch(() => undefined);
    return { tapped: null, leftPage: true };
  }
  return ok ? { tapped: label } : none;
}

/**
 * Tries to close the banners covering buttons on the current page (at most two), measuring the
 * page again after every tap. Returns `facts` with `closedWith` set on each covered button
 * whose own banner was closed and which could be tapped afterwards. Only `covered` changes;
 * everything else stays as first measured (the screenshot, taken before, shows that state).
 */
export async function dismissCoveringBanners(
  page: Page,
  facts: LayoutFacts,
  options: DismissOptions,
): Promise<LayoutFacts> {
  /** Banner (identified by its text) → label of the safe button tapped on it. */
  const tapped = new Map<string, string>();
  const tried = new Set<string>();
  let current = facts;
  for (let attempt = 0; attempt < MAX_COVERS; attempt += 1) {
    const next = current.covered.find((c) => c.cover && !tried.has(c.coverText));
    if (!next) break;
    tried.add(next.coverText);
    const result = await closeOne(page, next, options);
    if (result.tapped === null) {
      if (result.leftPage) return facts;
      continue;
    }
    tapped.set(next.coverText, result.tapped);
    current = await collectLayoutFacts(page);
  }
  if (tapped.size === 0) return facts;

  const stillCovered = new Set(current.covered.map(key));
  return {
    ...facts,
    covered: facts.covered.map((c) => {
      const closedWith = c.cover ? tapped.get(c.coverText) : undefined;
      return closedWith !== undefined && !stillCovered.has(key(c)) ? { ...c, closedWith } : c;
    }),
  };
}
