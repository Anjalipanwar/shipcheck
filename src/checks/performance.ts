import { makeFinding } from '../report/schema.js';
import type { CheckResult } from './types.js';

/**
 * Thresholds (SPEC §6.2 "documented in code").
 * - LCP: Google's Core Web Vitals call a "largest contentful paint" above 4 s "poor".
 * - Full load: above 6 s on a fast connection, most visitors will have noticed the wait.
 * Measured once, on a fast machine and connection, so real visitors will usually see worse.
 */
export const SLOW_LCP_MS = 4000;
export const SLOW_LOAD_MS = 6000;

export interface PerformanceFacts {
  url: string;
  /** Time until the page finished loading, in ms. */
  loadMs: number | null;
  /** Time until the biggest visible element was shown, in ms. */
  lcpMs: number | null;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} seconds`;

export function checkPerformance(facts: PerformanceFacts): CheckResult {
  const { url, loadMs, lcpMs } = facts;
  if (loadMs === null && lcpMs === null) {
    return {
      findings: [],
      passed: [],
      notTested: ['Page speed — the browser gave no timing data'],
    };
  }

  const slowLcp = lcpMs !== null && lcpMs > SLOW_LCP_MS;
  const slowLoad = loadMs !== null && loadMs > SLOW_LOAD_MS;
  if (!slowLcp && !slowLoad) {
    const measured = lcpMs ?? loadMs ?? 0;
    return {
      findings: [],
      passed: [`Home page loads quickly (main content visible after ${seconds(measured)})`],
      notTested: [],
    };
  }

  const logs = [
    ...(lcpMs !== null
      ? [`Main content visible after: ${Math.round(lcpMs)} ms (slow above ${SLOW_LCP_MS} ms)`]
      : []),
    ...(loadMs !== null
      ? [`Page fully loaded after: ${Math.round(loadMs)} ms (slow above ${SLOW_LOAD_MS} ms)`]
      : []),
  ];
  return {
    findings: [
      makeFinding({
        rule: 'performance/slow-landing',
        title: 'Your home page is slow to load',
        severity: 'minor',
        category: 'performance',
        flow: 'landing',
        device: 'desktop',
        whatHappened: slowLcp
          ? `It took ${seconds(lcpMs)} until the main content of the home page was visible.`
          : `It took ${seconds(loadMs ?? 0)} until the home page finished loading.`,
        whyItMatters:
          'Many visitors leave when a page takes more than a few seconds — and this was measured on a fast connection.',
        stepsToReproduce: [
          `Open ${url} in a new private window.`,
          'Notice how long it takes until the page is usable.',
        ],
        evidence: { screenshots: [], logs, url },
        fixPrompt:
          'My landing page loads slowly. Please speed it up: compress and lazy-load images, avoid loading large scripts before the first paint, and remove unused libraries. Aim for the main content to be visible in under 2.5 seconds.',
        confidence: 'verified',
      }),
    ],
    passed: [],
    notTested: [],
  };
}
