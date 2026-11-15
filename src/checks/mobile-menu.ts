import type { Page } from 'playwright';
import { z } from 'zod';
import type { DeviceName } from '../browser/devices.js';
import { readElementFacts, XPATH_OF_SOURCE } from '../browser/element.js';
import type { Evidence } from '../browser/evidence.js';
import { judgeAction, type ProposedAction } from '../browser/guard.js';
import { makeFinding } from '../report/schema.js';
import type { CheckResult } from './types.js';

/**
 * "Menu won't open" (SPEC §6.1 flow 6): on a phone, find the menu button in the page header,
 * tap it once and see whether more links or buttons become visible. The tap goes through the
 * same guard as every AI action, so a "menu" button that would log out or delete is never tapped.
 */

const SETTLE_MS = 700;

const FIND_TOGGLE = `(() => {
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  ${XPATH_OF_SOURCE}
  const candidates = [...document.querySelectorAll(
    'button[aria-expanded], [role="button"][aria-expanded], button[aria-controls], ' +
    'button[aria-label*="menu" i], [role="button"][aria-label*="menu" i], ' +
    'button[class*="menu" i], button[class*="burger" i], button[class*="nav-toggle" i], ' +
    'button[class*="navbar-toggler" i], button[id*="menu" i], summary'
  )].filter((el) => shown(el) &&
    (el.closest('header, nav, [role="banner"], [role="navigation"]') !== null ||
      el.getBoundingClientRect().top < 120));
  const toggle = candidates[0];
  if (!toggle) return null;
  const label = (toggle.getAttribute('aria-label') || toggle.innerText || toggle.getAttribute('title') || 'menu button')
    .replace(/\\s+/g, ' ').trim().slice(0, 60);
  // Same header = same menu: the button's label plus the link paths in its header (and in the
  // panel it controls). Paths, not texts, so a highlighted "current page" link changes nothing.
  const scope = toggle.closest('header, [role="banner"]') ||
    toggle.closest('nav, [role="navigation"]') || document.body;
  const controlled = toggle.getAttribute('aria-controls')
    ? document.getElementById(toggle.getAttribute('aria-controls')) : null;
  const paths = new Set();
  for (const root of [scope, controlled]) {
    if (!root) continue;
    for (const link of root.querySelectorAll('a[href]')) {
      try { paths.add(new URL(link.href).pathname); } catch (error) { /* ignore odd links */ }
    }
  }
  return { selector: 'xpath=' + xpathOf(toggle), label,
    signature: label.toLowerCase() + '|' + [...paths].sort().join(',') };
})()`;

/** How many links and buttons a visitor can see right now. */
const COUNT_VISIBLE = `(() => [...document.querySelectorAll('a[href], button, [role="menuitem"]')]
  .filter((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' &&
      style.display !== 'none' && Number(style.opacity) > 0 &&
      box.bottom > 0 && box.right > 0 && box.left < innerWidth;
  }).length)()`;

const ToggleSchema = z
  .object({ selector: z.string(), label: z.string(), signature: z.string() })
  .nullable();

export interface MenuCheckOptions {
  device: DeviceName;
  evidence: Evidence;
  /** Test-only switch, as in flows: production code never turns the guard off. */
  guardEnabled?: boolean;
  /**
   * Menus already checked on earlier pages of this run (their fingerprints). A menu found here
   * again is skipped; a new one is added after it is checked.
   */
  seen?: Set<string>;
  /** Set when this is not the page the run started on: named in the finding's title. */
  pagePath?: string;
}

export async function checkPhoneMenu(page: Page, options: MenuCheckOptions): Promise<CheckResult> {
  const none: CheckResult = { findings: [], passed: [], notTested: [] };
  const toggle = ToggleSchema.parse(await page.evaluate(FIND_TOGGLE));
  if (!toggle) return none; // No menu button: the menu links are shown directly (or there are none).
  if (options.seen?.has(toggle.signature)) return none; // same header as an earlier page
  options.seen?.add(toggle.signature);

  const action: ProposedAction = {
    selector: toggle.selector,
    description: `Menu button “${toggle.label}”`,
    method: 'click',
    arguments: [],
  };
  const facts = await readElementFacts(page, toggle.selector);
  const verdict =
    options.guardEnabled === false ? { allowed: true as const } : judgeAction(action, facts);
  const logged = {
    device: options.device,
    flow: 'mobile',
    intent: `Tap the menu button “${toggle.label}”`,
    action: 'click',
    locator: toggle.selector,
    url: page.url(),
  };
  if (!verdict.allowed) {
    options.evidence.logAction({ ...logged, result: 'blocked', detail: verdict.reason });
    return {
      ...none,
      notTested: [`The phone menu — ShipCheck did not tap “${toggle.label}” (${verdict.reason})`],
    };
  }

  const before = z.number().parse(await page.evaluate(COUNT_VISIBLE));
  const beforeShot = await options.evidence.screenshot(page, options.device, 'phone menu closed');
  let ok = true;
  try {
    await page.locator(toggle.selector).click({ timeout: 5000 });
  } catch {
    ok = false;
  }
  await page.waitForTimeout(SETTLE_MS);
  const after = z.number().parse(await page.evaluate(COUNT_VISIBLE));
  options.evidence.logAction({ ...logged, result: ok ? 'ok' : 'failed' });

  if (!ok) {
    return {
      ...none,
      notTested: [`The phone menu — the menu button “${toggle.label}” could not be tapped`],
    };
  }
  if (after > before) {
    return { ...none, passed: ['The menu opens on a phone'] };
  }
  const afterShot = await options.evidence.screenshot(page, options.device, 'phone menu after tap');
  return {
    ...none,
    findings: [
      makeFinding({
        rule: 'mobile/menu-does-not-open',
        title: options.pagePath
          ? `The menu on ${options.pagePath} does not open on a phone`
          : 'The menu does not open on a phone',
        severity: 'major',
        category: 'mobile',
        flow: 'mobile',
        device: 'mobile',
        whatHappened: `On a phone-sized screen the menu is behind a button (“${toggle.label}”). Tapping it showed no new links or buttons.`,
        whyItMatters:
          'Phone visitors can’t reach the other pages of the app, such as signing up or pricing.',
        stepsToReproduce: [
          `Open ${page.url()} on a phone (or in Chrome’s phone view: right-click → Inspect → the phone icon).`,
          `Tap the menu button “${toggle.label}”.`,
          'The menu does not open.',
        ],
        evidence: {
          screenshots: [beforeShot?.file, afterShot?.file].filter((f): f is string => Boolean(f)),
          logs: [
            `Tapped: ${toggle.selector}`,
            `Links and buttons visible before the tap: ${before}, after: ${after}`,
          ],
          url: page.url(),
        },
        fixPrompt: `On phones, the menu button “${toggle.label}” in my app's header does not open the menu. Please check its click handler and the CSS that shows the menu on small screens (for example the class it toggles and any "display: none" rule), so that tapping it shows the menu links, and set aria-expanded="true" while it is open.`,
        confidence: 'verified',
      }),
    ],
  };
}
