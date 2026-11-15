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

/** Buttons inside the covering box. Links are left out: following one could leave the page. */
const FIND_BUTTONS = `((cover) => {
  ${XPATH_OF_SOURCE}
  const found = document.evaluate(cover.replace(/^xpath=/, ''), document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  if (!found || found.nodeType !== 1) return [];
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

/**
 * Tries to close the banners covering buttons on the current page, then measures again. Returns
 * `facts` with `closedWith` set on each covered button whose own banner was closed and which could be
 * tapped afterwards. Only
 * `covered` changes; everything else stays as first measured (the screenshot shows that state).
 */
export async function dismissCoveringBanners(
  page: Page,
  facts: LayoutFacts,
  options: DismissOptions,
): Promise<LayoutFacts> {
  const covers = [...new Set(facts.covered.flatMap((c) => (c.cover ? [c.cover] : [])))].slice(
    0,
    MAX_COVERS,
  );
  if (covers.length === 0) return facts;

  const startUrl = page.url();
  /** Cover address → label of the safe button tapped on it. */
  const tapped = new Map<string, string>();
  for (const cover of covers) {
    const buttons = ButtonsSchema.parse(
      await page.evaluate(`${FIND_BUTTONS}(${JSON.stringify(cover)})`),
    );
    const choice = buttons
      .map((b) => ({ ...b, kind: safeDismissKind(b.names) }))
      .filter((b): b is typeof b & { kind: SafeDismiss } => b.kind !== null)
      .sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];
    if (!choice) continue; // nothing safe to tap: the banner stays, the button stays covered

    const label = choice.names[0] ?? choice.kind;
    const logged = {
      device: options.device,
      flow: 'mobile',
      intent: `Close the banner covering a button (“${label}”)`,
      action: 'click',
      locator: choice.selector,
      url: page.url(),
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
      continue;
    }
    let ok = true;
    try {
      await page.locator(choice.selector).click({ timeout: 3000 });
    } catch {
      ok = false;
    }
    await page.waitForTimeout(SETTLE_MS);
    options.evidence.logAction({ ...logged, result: ok ? 'ok' : 'failed' });
    if (page.url() !== startUrl) {
      // The "close" button left the page: nothing can be judged on it any more.
      return facts;
    }
    if (ok) tapped.set(cover, label);
  }
  if (tapped.size === 0) return facts;

  const after = await collectLayoutFacts(page);
  const stillCovered = new Set(after.covered.map(key));
  return {
    ...facts,
    covered: facts.covered.map((c) => {
      const closedWith = c.cover ? tapped.get(c.cover) : undefined;
      return closedWith !== undefined && !stillCovered.has(key(c)) ? { ...c, closedWith } : c;
    }),
  };
}
