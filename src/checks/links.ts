import type { DomainLock } from '../browser/domain.js';
import { isRiskyUrl } from '../browser/guard.js';
import { makeFinding, type Finding } from '../report/schema.js';
import type { PageFacts, PageLink } from './collect.js';
import type { CheckResult } from './types.js';

/** SPEC §6.2: at most 50 links/images are checked. */
export const MAX_LINK_CHECKS = 50;
const CONCURRENCY = 5;

/**
 * Where a link sits, which sets how bad it is when broken (owner decision, 2026-11-14):
 * `navigation` (page header / main menu) and `call-to-action` (sign up, log in, checkout or a
 * link styled as the page's main button) are Major; `other` links are Minor.
 */
export type LinkPlacement = 'navigation' | 'call-to-action' | 'other';

export interface LinkTarget {
  url: string;
  kind: 'link' | 'image';
  /** The page it was found on. */
  foundOn: string;
  /** Links only: the most prominent place the address was found in. */
  placement?: LinkPlacement;
  /** Links only: the link's visible text at that place. */
  text?: string;
}

/** Words that make a link a primary call-to-action, in its text or its address. */
const CTA_TEXT =
  /\b(sign[\s-]?up|register|create (an |your )?account|get started|start (for )?free|try (it )?(for )?free|join( now| free)?|log[\s-]?in|sign[\s-]?in|check[\s-]?out|buy( now)?|subscribe|upgrade|registrieren|anmelden|einloggen|kasse|jetzt kaufen)\b/i;
const CTA_PATH =
  /(^|\/)(sign[-_]?up|register|registration|join|log[-_]?in|sign[-_]?in|checkout|get[-_]?started|subscribe)(\/|\.|$)/i;

/** Decides how prominent a link is. Pure, so it can be unit-tested without a browser. */
export function linkPlacement(
  link: Pick<PageLink, 'href' | 'text' | 'inNavigation' | 'looksLikeButton'>,
): LinkPlacement {
  if (link.inNavigation) return 'navigation';
  if (link.looksLikeButton || CTA_TEXT.test(link.text)) return 'call-to-action';
  try {
    if (CTA_PATH.test(new URL(link.href).pathname)) return 'call-to-action';
  } catch {
    // Not a valid address — treated as an ordinary link.
  }
  return 'other';
}

const PLACEMENT_RANK: Record<LinkPlacement, number> = {
  navigation: 2,
  'call-to-action': 1,
  other: 0,
};

export interface LinkSelection {
  targets: LinkTarget[];
  skippedForSafety: number;
  skippedOverCap: number;
}

function withoutHash(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Picks which links and images to check: only those on the tested site, each address once,
 * never one that might change something when opened (log out, delete, unsubscribe…).
 */
export function selectLinkTargets(
  pages: readonly Pick<PageFacts, 'url' | 'links' | 'images'>[],
  lock: DomainLock,
  cap: number = MAX_LINK_CHECKS,
): LinkSelection {
  const seen = new Set<string>();
  const candidates: LinkTarget[] = [];
  const byUrl = new Map<string, LinkTarget>();
  let skippedForSafety = 0;

  const consider = (raw: string, kind: LinkTarget['kind'], foundOn: string, link?: PageLink) => {
    let url: string;
    try {
      if (!/^https?:/i.test(raw)) return;
      url = withoutHash(raw);
    } catch {
      return;
    }
    if (!lock.isAllowed(url)) return;
    const placement = link ? linkPlacement(link) : undefined;
    const known = byUrl.get(url);
    if (known && placement && known.kind === 'link') {
      // The same address in a more prominent place (e.g. a body link that is also in the menu)
      // takes that place, so a broken menu link is never downgraded by an earlier body link.
      if (PLACEMENT_RANK[placement] > PLACEMENT_RANK[known.placement ?? 'other']) {
        Object.assign(known, { placement, foundOn, ...(link?.text ? { text: link.text } : {}) });
      }
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    if (kind === 'link' && isRiskyUrl(url)) {
      skippedForSafety += 1;
      return;
    }
    const target: LinkTarget = {
      url,
      kind,
      foundOn,
      ...(placement ? { placement } : {}),
      ...(link?.text ? { text: link.text } : {}),
    };
    byUrl.set(url, target);
    candidates.push(target);
  };

  for (const page of pages) {
    seen.add(withoutHash(page.url));
    for (const image of page.images) consider(image.src, 'image', page.url);
    for (const link of page.links) consider(link.href, 'link', page.url, link);
  }

  return {
    targets: candidates.slice(0, cap),
    skippedForSafety,
    skippedOverCap: Math.max(0, candidates.length - cap),
  };
}

export interface LinkProbe {
  /** HTTP status; 0 = no answer. */
  status: number;
  /** Set when we did not get a usable answer for a reason other than the link being broken. */
  inconclusive?: boolean;
}

export type LinkProber = (url: string, method: 'HEAD' | 'GET') => Promise<LinkProbe>;

async function probe(target: LinkTarget, prober: LinkProber): Promise<LinkProbe> {
  const head = await prober(target.url, 'HEAD');
  // Some servers refuse HEAD or answer it wrongly; a GET settles it.
  if (head.status >= 400 || head.status === 0) return prober(target.url, 'GET');
  return head;
}

export async function checkLinks(
  selection: LinkSelection,
  prober: LinkProber,
): Promise<CheckResult> {
  const { targets } = selection;
  const broken: { target: LinkTarget; status: number }[] = [];
  let inconclusive = 0;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((target) => probe(target, prober)));
    results.forEach((result, index) => {
      const target = batch[index];
      if (!target) return;
      if (result.inconclusive) inconclusive += 1;
      else if (result.status >= 400 || result.status === 0)
        broken.push({ target, status: result.status });
    });
  }

  const findings: Finding[] = [];
  const describe = (b: { target: LinkTarget; status: number }) =>
    `${b.status === 0 ? 'no answer' : b.status} ${b.target.url}${placeText(b.target)} — found on ${b.target.foundOn}`;

  const brokenLinks = broken.filter((b) => b.target.kind === 'link');
  const key = brokenLinks.filter((b) => b.target.placement && b.target.placement !== 'other');
  const other = brokenLinks.filter((b) => !b.target.placement || b.target.placement === 'other');
  if (key.length > 0) findings.push(brokenLinkFinding(key, 'key', describe));
  if (other.length > 0) findings.push(brokenLinkFinding(other, 'other', describe));

  const brokenImages = broken.filter((b) => b.target.kind === 'image');
  const firstImage = brokenImages[0];
  if (firstImage) {
    findings.push(
      makeFinding({
        rule: 'links/broken-image',
        title:
          brokenImages.length === 1
            ? 'An image in your app does not load'
            : `${brokenImages.length} images in your app do not load`,
        severity: 'minor',
        category: 'functional',
        device: 'both',
        whatHappened: `${brokenImages.length === 1 ? 'One image file is' : `${brokenImages.length} image files are`} missing, so visitors see an empty box or a broken-picture icon.`,
        whyItMatters: 'Missing pictures make a page look broken and unfinished.',
        stepsToReproduce: [
          `Open ${firstImage.target.foundOn}.`,
          'Look for an empty box or broken-picture icon where an image should be.',
        ],
        evidence: {
          screenshots: [],
          logs: brokenImages.slice(0, 10).map(describe),
          url: firstImage.target.foundOn,
        },
        fixPrompt: `These images fail to load in my app. Please fix the file paths or add the missing files:\n${brokenImages
          .slice(0, 10)
          .map((b) => `- ${b.target.url} (used on ${b.target.foundOn})`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const checkedOk = targets.length - broken.length - inconclusive;
  const notTested: string[] = [];
  if (selection.skippedForSafety > 0) {
    notTested.push(
      `${selection.skippedForSafety} ${selection.skippedForSafety === 1 ? 'link was' : 'links were'} not opened, to be safe (the address looked like it could log out, delete or confirm something)`,
    );
  }
  if (selection.skippedOverCap > 0) {
    notTested.push(
      `${selection.skippedOverCap} more links and images (only the first ${targets.length} are checked)`,
    );
  }
  if (inconclusive > 0)
    notTested.push(`${inconclusive} links could not be checked (no clear answer)`);

  return {
    findings,
    passed: checkedOk > 0 ? [`${checkedOk} links and images on your own site work`] : [],
    notTested,
  };
}

function placeText(target: LinkTarget): string {
  const label = target.text ? `“${target.text}”` : 'a link';
  if (target.placement === 'navigation') return ` (${label} in the page header or main menu)`;
  if (target.placement === 'call-to-action')
    return ` (${label}, a main button or sign-up/log-in link)`;
  return target.text ? ` (${label})` : '';
}

function keyTitle(group: { target: LinkTarget }[]): string {
  const allMenu = group.every((b) => b.target.placement === 'navigation');
  const allCta = group.every((b) => b.target.placement === 'call-to-action');
  if (group.length === 1) {
    const text = group[0]?.target.text ? ` “${group[0].target.text}”` : '';
    if (allMenu) return `The${text} link in your main menu leads to a page that does not exist`;
    return `Your main button${text} leads to a page that does not exist`;
  }
  if (allMenu) return `${group.length} links in your main menu lead to pages that do not exist`;
  if (allCta) return `${group.length} of your main buttons lead to pages that do not exist`;
  return `${group.length} links in your main menu or main buttons lead to pages that do not exist`;
}

function brokenLinkFinding(
  group: { target: LinkTarget; status: number }[],
  kind: 'key' | 'other',
  describe: (b: { target: LinkTarget; status: number }) => string,
): Finding {
  const first = group[0] as { target: LinkTarget; status: number };
  const isKey = kind === 'key';
  return makeFinding({
    rule: isKey ? 'links/broken-link' : 'links/broken-other-link',
    title: isKey
      ? keyTitle(group)
      : group.length === 1
        ? 'A link in your app leads to a page that does not exist'
        : `${group.length} links in your app lead to pages that do not exist`,
    severity: isKey ? 'major' : 'minor',
    category: 'functional',
    device: 'both',
    whatHappened: `${group.length === 1 ? 'One link points' : `${group.length} links point`} to an address that answers with “not found” or an error.${isKey ? ' It sits where almost every visitor looks: the page header, the main menu or a main button.' : ''}`,
    whyItMatters: isKey
      ? 'Visitors use the menu and the main buttons to find their way around and to sign up. A dead end there loses them at exactly the moment they were interested.'
      : 'Visitors who click it hit a dead end, which makes the app feel unfinished.',
    stepsToReproduce: [
      `Open ${first.target.foundOn}.`,
      `Click ${first.target.text ? `the link “${first.target.text}”` : 'the link'} that goes to ${first.target.url}.`,
      'An error page appears instead of the expected page.',
    ],
    evidence: {
      screenshots: [],
      logs: group.slice(0, 10).map(describe),
      url: first.target.foundOn,
    },
    fixPrompt: `These links in my app are broken. For each one, either create the missing page, point the link to the right address, or remove the link:\n${group
      .slice(0, 10)
      .map((b) => `- ${b.target.url}${placeText(b.target)} (linked from ${b.target.foundOn})`)
      .join('\n')}`,
    confidence: 'verified',
  });
}
