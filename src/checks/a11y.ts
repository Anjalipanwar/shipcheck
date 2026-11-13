import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';
import { makeFinding } from '../report/schema.js';
import type { CheckResult } from './types.js';

export interface A11yViolation {
  /** axe rule id, e.g. "color-contrast". */
  id: string;
  impact: string | null | undefined;
  /** axe's own one-line description. */
  help: string;
  /** How many elements on the page are affected. */
  count: number;
  pageUrl: string;
}

/** Plain-English wording for the problems we see most often. */
const PLAIN: Record<string, string> = {
  'color-contrast': 'Some text is hard to read because it is too pale against its background',
  'image-alt': 'Some images have no text description for people who cannot see them',
  label: 'Some form fields have no label, so screen readers cannot say what to type',
  'button-name': 'Some buttons have no readable name (for example icon-only buttons)',
  'link-name': 'Some links have no readable text',
  'select-name': 'Some drop-down lists have no label',
  'aria-required-attr': 'Some custom controls are missing information that screen readers need',
  'aria-valid-attr-value': 'Some custom controls give screen readers wrong information',
  'meta-viewport': 'The page stops people from zooming in on a phone',
  'html-has-lang': 'The page does not say which language it is written in',
  'document-title': 'The page has no title',
  'frame-title': 'An embedded frame has no title',
  'input-button-name': 'Some input buttons have no readable name',
  'nested-interactive': 'Some clickable items are placed inside other clickable items',
};

/** Runs the axe accessibility scanner on the current page. */
export async function runAxe(page: Page): Promise<A11yViolation[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    count: violation.nodes.length,
    pageUrl: page.url(),
  }));
}

/** SPEC §6.2: only serious/critical problems, grouped into one Minor finding. */
export function checkA11y(violations: readonly A11yViolation[], pagesScanned: number): CheckResult {
  if (pagesScanned === 0) {
    return {
      findings: [],
      passed: [],
      notTested: ['Accessibility basics — the scan could not run'],
    };
  }
  const relevant = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (relevant.length === 0) {
    return {
      findings: [],
      passed: [
        `No serious accessibility problems found on ${pagesScanned === 1 ? 'the page' : `the ${pagesScanned} pages`} we scanned`,
      ],
      notTested: [],
    };
  }

  const byRule = new Map<string, { help: string; count: number; pages: Set<string> }>();
  for (const violation of relevant) {
    const entry = byRule.get(violation.id) ?? { help: violation.help, count: 0, pages: new Set() };
    entry.count += violation.count;
    entry.pages.add(violation.pageUrl);
    byRule.set(violation.id, entry);
  }
  const rules = [...byRule.entries()];
  const firstPage = relevant[0]?.pageUrl ?? '';

  return {
    findings: [
      makeFinding({
        rule: 'a11y/serious-violations',
        title: 'Some people will have trouble using your app (accessibility problems)',
        severity: 'minor',
        category: 'accessibility',
        device: 'desktop',
        whatHappened: `An automatic scan found ${rules.length === 1 ? 'a problem' : `${rules.length} kinds of problems`} that make the app hard to use for people with poor eyesight or who use a keyboard or screen reader: ${rules
          .map(([id, entry]) => PLAIN[id] ?? entry.help)
          .join('; ')}.`,
        whyItMatters:
          'Roughly one in six people has some form of disability. These problems can also be a legal issue for businesses selling in the EU.',
        stepsToReproduce: [
          `Open ${firstPage}.`,
          'Install the free “axe DevTools” browser extension and run a scan to see each affected element.',
        ],
        evidence: {
          screenshots: [],
          logs: rules.map(
            ([id, entry]) =>
              `${PLAIN[id] ?? entry.help} — ${entry.count} ${entry.count === 1 ? 'place' : 'places'} [${id}] on ${[...entry.pages].join(', ')}`,
          ),
          url: firstPage,
        },
        fixPrompt: `An axe accessibility scan of my app reported these serious issues. Please fix all of them without changing the visual design more than necessary:\n${rules
          .map(
            ([id, entry]) =>
              `- ${id}: ${entry.help} (${entry.count} elements, on ${[...entry.pages].join(', ')})`,
          )
          .join('\n')}`,
        confidence: 'verified',
      }),
    ],
    passed: [],
    notTested: [],
  };
}
