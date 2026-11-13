import { DESKTOP } from './browser/devices.js';
import { Evidence, type Screenshot } from './browser/evidence.js';
import { isRiskyUrl } from './browser/guard.js';
import { BrowserSession, gotoWithRetry, type DevicePage } from './browser/session.js';
import { checkA11y, runAxe, type A11yViolation } from './checks/a11y.js';
import {
  collectPageFacts,
  collectTimings,
  visibleTextLength,
  type PageFacts,
} from './checks/collect.js';
import { checkErrors } from './checks/errors.js';
import { safeFetch } from './checks/fetch.js';
import { checkHeaders } from './checks/headers.js';
import { checkHttps } from './checks/https.js';
import { checkLinks, selectLinkTargets, type LinkProbe } from './checks/links.js';
import { checkPerformance } from './checks/performance.js';
import { checkSecrets, type SecretSource } from './checks/secrets.js';
import { checkSeo } from './checks/seo.js';
import type { CheckResult } from './checks/types.js';
import type { Config } from './config.js';
import { makeFinding, type Finding, type Report } from './report/schema.js';
import { computeVerdict, countBySeverity, rankFindings } from './report/verdict.js';
import { VERSION } from './version.js';

export interface RunHooks {
  /** Called with one plain-English line per finished step. */
  progress?: (line: string) => void;
}

export interface RunResult {
  report: Report;
  screenshots: Screenshot[];
  /** Scrubs protected values (passwords, keys) from a text. */
  redact: (text: string) => string;
}

const CHECK_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_FILES = 30;
/** HTTP answers that mean "you may not see this", not "this is broken". */
const NOT_BROKEN_STATUSES = new Set([401, 403, 405, 429]);

class Collector {
  readonly findings: Finding[] = [];
  readonly passed: string[] = [];
  readonly notTested: string[] = [];
  partial = false;

  add(result: CheckResult): void {
    this.findings.push(...result.findings);
    this.passed.push(...result.passed);
    this.notTested.push(...result.notTested);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function summarize(result: CheckResult): string {
  const issues = result.findings.filter((f) => f.severity !== 'info').length;
  if (issues > 0) return `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  if (result.passed.length > 0) return '✓';
  return result.notTested.length > 0 ? 'not checked' : '✓';
}

/**
 * Runs one ShipCheck pass and returns the report (nothing is written to disk here).
 * Every check is isolated: if one fails or runs out of time it is listed under
 * "What we couldn't test" and the run carries on (SPEC §8 robustness).
 */
export async function runShipCheck(config: Config, hooks: RunHooks = {}): Promise<RunResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + config.maxMinutes * 60_000;
  const progress = hooks.progress ?? (() => undefined);
  const evidence = new Evidence();
  evidence.protect(config.password);
  const collector = new Collector();

  /** Runs one named check with a timeout, inside the global time budget. */
  const step = async (label: string, work: () => Promise<CheckResult> | CheckResult) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      collector.partial = true;
      collector.notTested.push(
        `${label} — the time limit of ${config.maxMinutes} minutes was reached`,
      );
      progress(`${label}… skipped (time limit reached)`);
      return;
    }
    try {
      const result = await withTimeout(
        Promise.resolve().then(work),
        Math.min(CHECK_TIMEOUT_MS, remaining),
      );
      collector.add(result);
      progress(`${label}… ${summarize(result)}`);
    } catch {
      collector.notTested.push(`${label} — this check could not finish`);
      progress(`${label}… could not finish`);
    }
  };

  const session = await BrowserSession.launch({
    targetUrl: config.url,
    headed: config.headed,
    evidence,
  });
  try {
    const desktop = await session.open(DESKTOP);
    const userAgent = session.userAgentFor(DESKTOP);
    const fetchOptions = { lock: session.lock, userAgent };

    const landing = await openLanding(desktop, config.url, evidence, collector, progress);
    if (landing) {
      const { facts, headers, finalUrl } = landing;
      const origin = new URL(finalUrl).origin;
      const pages: PageFacts[] = [facts];
      const a11y: A11yViolation[] = [];
      let a11yPages = 0;

      await step('Secure connection (HTTPS)', () =>
        checkHttps({
          targetUrl: config.url,
          finalUrl,
          insecureRequests: evidence.events.flatMap((e) =>
            e.kind === 'insecure-request' ? [e.url] : [],
          ),
        }),
      );
      await step('Security settings', () => checkHeaders({ url: finalUrl, headers }));
      await step('Page speed', async () =>
        checkPerformance({ url: finalUrl, ...(await collectTimings(desktop.page)) }),
      );

      const rawHtml = await safeFetch(finalUrl, fetchOptions);
      await step('Search engine basics (SEO)', async () => {
        const exists = async (path: string): Promise<boolean | null> => {
          const result = await safeFetch(origin + path, fetchOptions);
          if (result.error) return null;
          return result.status >= 200 && result.status < 300 && result.body.trim().length > 0;
        };
        return checkSeo({
          page: facts,
          faviconIcoExists: facts.hasFaviconLink ? true : await exists('/favicon.ico'),
          robotsTxtExists: await exists('/robots.txt'),
          sitemapXmlExists: await exists('/sitemap.xml'),
          rawTextLength:
            rawHtml.error || rawHtml.status >= 400 ? null : visibleTextLength(rawHtml.body),
        });
      });

      const scanAccessibility = async () => {
        try {
          a11y.push(...(await withTimeout(runAxe(desktop.page), CHECK_TIMEOUT_MS)));
          a11yPages += 1;
        } catch {
          // Reported below as "could not run" if no page could be scanned at all.
        }
      };
      await scanAccessibility();

      // One more page, so links, images, scripts and accessibility are not judged on the
      // home page alone (SPEC §6.2). Only a safe link on the same site is followed.
      const renderedHtml = await desktop.page.content().catch(() => '');
      const second = facts.links.find(
        (link) =>
          session.lock.isAllowed(link) &&
          !isRiskyUrl(link) &&
          new URL(link).pathname !== new URL(finalUrl).pathname,
      );
      let secondHtml = '';
      if (second && Date.now() < deadline) {
        try {
          evidence.setScope('second page');
          const response = await gotoWithRetry(desktop.page, second);
          evidence.logAction({
            device: 'desktop',
            intent: 'Open a second page to widen the automatic checks',
            action: 'goto',
            url: second,
            result: response && response.status() < 400 ? 'ok' : 'failed',
          });
          if (response && response.status() < 400) {
            pages.push(await collectPageFacts(desktop.page));
            secondHtml = await desktop.page.content().catch(() => '');
            await scanAccessibility();
          }
        } catch {
          // The second page is a bonus; the home page results stand on their own.
        } finally {
          evidence.setScope(undefined);
        }
      }
      await step('Accessibility basics', () => checkA11y(a11y, a11yPages));

      await step('Exposed secret keys', async () => {
        const sources: SecretSource[] = [
          { url: finalUrl, content: renderedHtml },
          ...(rawHtml.error ? [] : [{ url: finalUrl, content: rawHtml.body }]),
          ...(second && secondHtml ? [{ url: second, content: secondHtml }] : []),
        ];
        const scripts = [...new Set(pages.flatMap((page) => page.scripts))]
          .filter((src) => session.lock.isAllowed(src))
          .slice(0, MAX_SCRIPT_FILES);
        for (const src of scripts) {
          if (Date.now() >= deadline) break;
          const file = await safeFetch(src, fetchOptions);
          if (!file.error && file.status < 400) sources.push({ url: src, content: file.body });
        }
        return checkSecrets(sources);
      });

      await step('Broken links and images', () =>
        checkLinks(
          selectLinkTargets(pages, session.lock),
          async (url, method): Promise<LinkProbe> => {
            const result = await safeFetch(url, { ...fetchOptions, method, maxBytes: 1 });
            if (result.error || NOT_BROKEN_STATUSES.has(result.status)) {
              return { status: result.status, inconclusive: true };
            }
            return { status: result.status };
          },
        ),
      );
    }

    // Last, because it looks at everything that happened during the run.
    await step('Hidden errors', () => checkErrors(evidence.events));
  } finally {
    await session.close();
  }

  const blockedSites = [
    ...new Set(
      evidence.events.flatMap((e) => {
        if (e.kind !== 'blocked-navigation') return [];
        try {
          return [new URL(e.url).host];
        } catch {
          return [];
        }
      }),
    ),
  ];
  if (blockedSites.length > 0) {
    collector.notTested.push(
      `Pages on other websites (${blockedSites.join(', ')}) — ShipCheck only tests the app you asked for`,
    );
  }
  if (config.noAi) {
    collector.notTested.push(
      'Signing up, logging in, the main feature, forms and the phone-sized pass — these need an AI key (this run used --no-ai)',
    );
  }

  const findings = rankFindings(collector.findings);
  const report: Report = {
    meta: {
      url: config.url,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      model: null,
      shipcheckVersion: VERSION,
      mode: 'no-ai',
      partial: collector.partial,
      llmCalls: 0,
    },
    verdict: computeVerdict(findings),
    counts: countBySeverity(findings),
    findings,
    passed: collector.passed,
    notTested: collector.notTested,
    actionLog: evidence.actionLog,
  };
  return { report, screenshots: evidence.screenshots, redact: (text) => evidence.redact(text) };
}

interface Landing {
  facts: PageFacts;
  headers: Record<string, string>;
  finalUrl: string;
}

/** Opens the home page. If it does not load, that is itself the (Blocker) finding. */
async function openLanding(
  desktop: DevicePage,
  url: string,
  evidence: Evidence,
  collector: Collector,
  progress: (line: string) => void,
): Promise<Landing | undefined> {
  evidence.setScope('landing');
  let status: number | null = null;
  let failure = '';
  let headers: Record<string, string> = {};
  try {
    const response = await gotoWithRetry(desktop.page, url);
    status = response?.status() ?? null;
    headers = response ? await response.allHeaders() : {};
  } catch (error) {
    failure = error instanceof Error ? (error.message.split('\n')[0] ?? '') : 'unknown error';
  }
  const loaded = status !== null && status < 400;
  evidence.logAction({
    device: 'desktop',
    intent: 'Open the home page',
    action: 'goto',
    url,
    result: loaded ? 'ok' : 'failed',
    ...(loaded ? {} : { detail: failure || `HTTP status ${status}` }),
  });
  const shot = await evidence.screenshot(desktop.page, 'desktop', 'home page');
  evidence.setScope(undefined);

  if (!loaded) {
    collector.findings.push(
      makeFinding({
        rule: 'landing/not-loading',
        title: 'Your app’s home page does not load',
        severity: 'blocker',
        category: 'functional',
        flow: 'landing',
        device: 'desktop',
        whatHappened:
          status !== null
            ? `Opening the app showed an error page instead of the app (the server answered with error code ${status}).`
            : 'Opening the app did not work: the browser could not reach it or it took longer than 30 seconds.',
        whyItMatters: 'Nobody can use the app if its first page does not open.',
        stepsToReproduce: [`Open ${url} in a new private browser window.`],
        evidence: {
          screenshots: shot ? [shot.file] : [],
          logs: [
            status !== null
              ? `Server answered: HTTP ${status}`
              : `Browser error: ${failure || 'no answer'}`,
          ],
          url,
        },
        fixPrompt:
          'My deployed app does not load at its public address. Please check the latest deployment and its build logs, fix whatever stops the home page from being served, and confirm the address opens in a private browser window.',
        confidence: 'verified',
      }),
    );
    collector.notTested.push('All page checks — the home page did not load');
    progress('Opening your app… it did not load');
    return undefined;
  }

  progress('Opening your app… ✓');
  collector.passed.push('Home page opens');
  return { facts: await collectPageFacts(desktop.page), headers, finalUrl: desktop.page.url() };
}
