import type { DomainLock } from '../browser/domain.js';
import { isRiskyUrl } from '../browser/guard.js';
import { makeFinding, type Finding } from '../report/schema.js';
import type { PageFacts } from './collect.js';
import type { CheckResult } from './types.js';

/** SPEC §6.2: at most 50 links/images are checked. */
export const MAX_LINK_CHECKS = 50;
const CONCURRENCY = 5;

export interface LinkTarget {
  url: string;
  kind: 'link' | 'image';
  /** The page it was found on. */
  foundOn: string;
}

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
  let skippedForSafety = 0;

  const consider = (raw: string, kind: LinkTarget['kind'], foundOn: string) => {
    let url: string;
    try {
      if (!/^https?:/i.test(raw)) return;
      url = withoutHash(raw);
    } catch {
      return;
    }
    if (!lock.isAllowed(url) || seen.has(url)) return;
    seen.add(url);
    if (kind === 'link' && isRiskyUrl(url)) {
      skippedForSafety += 1;
      return;
    }
    candidates.push({ url, kind, foundOn });
  };

  for (const page of pages) {
    seen.add(withoutHash(page.url));
    for (const image of page.images) consider(image.src, 'image', page.url);
    for (const link of page.links) consider(link, 'link', page.url);
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
    `${b.status === 0 ? 'no answer' : b.status} ${b.target.url} — found on ${b.target.foundOn}`;

  const brokenLinks = broken.filter((b) => b.target.kind === 'link');
  const first = brokenLinks[0];
  if (first) {
    findings.push(
      makeFinding({
        rule: 'links/broken-link',
        title:
          brokenLinks.length === 1
            ? 'A link in your app leads to a page that does not exist'
            : `${brokenLinks.length} links in your app lead to pages that do not exist`,
        severity: 'major',
        category: 'functional',
        device: 'both',
        whatHappened: `${brokenLinks.length === 1 ? 'One link points' : `${brokenLinks.length} links point`} to an address that answers with “not found” or an error.`,
        whyItMatters:
          'Visitors who click it hit a dead end, which makes the app feel unfinished and can lose them at exactly the moment they were interested.',
        stepsToReproduce: [
          `Open ${first.target.foundOn}.`,
          `Click the link that goes to ${first.target.url}.`,
          'An error page appears instead of the expected page.',
        ],
        evidence: {
          screenshots: [],
          logs: brokenLinks.slice(0, 10).map(describe),
          url: first.target.foundOn,
        },
        fixPrompt: `These links in my app are broken. For each one, either create the missing page, point the link to the right address, or remove the link:\n${brokenLinks
          .slice(0, 10)
          .map((b) => `- ${b.target.url} (linked from ${b.target.foundOn})`)
          .join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

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
