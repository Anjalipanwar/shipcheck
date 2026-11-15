import { LlmBudget, type BudgetSummary } from './ai/budget.js';
import { createStagehandDriver, freePort, type AiDriver } from './ai/driver.js';
import type { ModelChoice } from './ai/models.js';
import { DESKTOP, MOBILE, type DevicePreset } from './browser/devices.js';
import { Evidence, type Screenshot } from './browser/evidence.js';
import { isRiskyUrl } from './browser/guard.js';
import { BrowserSession, gotoWithRetry, type DevicePage } from './browser/session.js';
import { checkA11y, runAxe, type A11yViolation } from './checks/a11y.js';
import { describeBlocking, separateShipCheckBlocking } from './checks/blocked.js';
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
import { checkLinks, linkPlacement, selectLinkTargets, type LinkProbe } from './checks/links.js';
import { dismissCoveringBanners } from './checks/mobile-banner.js';
import { checkPhoneMenu } from './checks/mobile-menu.js';
import { collectLayoutFacts, judgeLayout, type CheckedPage } from './checks/mobile-layout.js';
import { checkPerformance } from './checks/performance.js';
import { checkSecrets, type SecretSource } from './checks/secrets.js';
import { checkSeo } from './checks/seo.js';
import type { CheckResult } from './checks/types.js';
import type { Config } from './config.js';
import { judge } from './ai/judge.js';
import {
  CoverageRecorder,
  flowOutcome,
  phoneOutcome,
  reasonOf,
  withAdvice,
  type Outcome,
} from './coverage.js';
import { FLOW_LABEL, runFlow, type FlowBody } from './flows/context.js';
import { coreFlow } from './flows/core.js';
import { formsFlow } from './flows/forms.js';
import { landingFlow } from './flows/landing.js';
import { loginFlow } from './flows/login.js';
import { signupFlow } from './flows/signup.js';
import type { FlowDeps, FlowName, FlowResult, Observation, SharedState } from './flows/types.js';
import { ADVICE, AREA_LABEL, NEEDS_FULL_CHECK } from './report/present.js';
import { redactDeep } from './report/write.js';
import { makeFinding, type CoverageArea, type Finding, type Report } from './report/schema.js';
import { computeVerdict, countBySeverity, rankFindings } from './report/verdict.js';
import { VERSION } from './version.js';

export interface RunHooks {
  /** Called with one plain-English line per finished step. */
  progress?: (line: string) => void;
}

/** How the AI part of a run is set up. Not needed for --no-ai runs. */
export interface RunOptions {
  /** The model and key to use (from chooseModel). */
  model?: ModelChoice;
  /** Upper limit of AI calls for the run (SPEC §7.4: 150). */
  maxLlmCalls?: number;
  /** Tests only: a scripted stand-in for the AI layer (it is handed the run's call budget). */
  aiDriver?: (budget: LlmBudget) => AiDriver;
  /** Tests only: false switches the guard off to prove the network backstop holds on its own. */
  guardEnabled?: boolean;
}

export interface RunResult {
  report: Report;
  /** AI calls used, in total and per flow (absent in --no-ai runs). */
  llm?: BudgetSummary;
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
const FLOWS: Record<Exclude<FlowName, 'mobile'>, FlowBody> = {
  landing: landingFlow,
  signup: signupFlow,
  login: loginFlow,
  core: coreFlow,
  forms: formsFlow,
};

/** Flows repeated on the phone (SPEC §6.1 flow 6; signup too, because of planted bug #1). */
export const PHONE_FLOWS = ['landing', 'signup', 'login', 'core'] as const;
/** Coverage areas that need the AI tester (everything a visitor does). */
const USER_AREAS: readonly CoverageArea[] = ['signup', 'login', 'core', 'forms', 'phone-flows'];
const USED_FLOWS = 'you used --flows';
/** A phone flow is only started if at least this many AI calls are left. */
export const PHONE_FLOW_MIN_CALLS = 10;
/** Pages checked for phone layout: the home page and up to this many linked pages. */
const PHONE_LAYOUT_EXTRA_PAGES = 5;

/** Until the AI judge exists (M6), a problem a flow observed becomes a finding as it stands. */
function toFinding(observation: Observation, device: 'desktop' | 'mobile' = 'desktop'): Finding {
  return makeFinding({
    rule: observation.rule,
    title: observation.title,
    severity: observation.severity,
    category: observation.category,
    flow: observation.flow,
    device,
    whatHappened:
      observation.severity === 'info'
        ? observation.actual
        : `${observation.actual} What should happen: ${observation.expected}`,
    whyItMatters: observation.whyItMatters,
    stepsToReproduce: observation.steps,
    evidence: {
      screenshots: observation.screenshots,
      logs: observation.logs,
      url: observation.url,
    },
    ...(observation.fixPrompt ? { fixPrompt: observation.fixPrompt } : {}),
    confidence: observation.confidence,
  });
}

function flowSummary(result: FlowResult): string {
  const issues = result.observations.filter((o) => !o.ok && o.severity !== 'info').length;
  if (issues > 0) return `${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  if (result.status === 'completed') return result.notTested.length > 0 ? 'not tested' : '✓';
  return result.status === 'stopped' ? 'stopped early' : 'could not finish';
}

export async function runShipCheck(
  config: Config,
  hooks: RunHooks = {},
  options: RunOptions = {},
): Promise<RunResult> {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + config.maxMinutes * 60_000;
  const progress = hooks.progress ?? (() => undefined);
  const evidence = new Evidence();
  evidence.protect(config.password);
  evidence.protect(options.model?.apiKey);
  const collector = new Collector();
  const coverage = new CoverageRecorder();
  const useAi = !config.noAi;
  if (useAi && !options.model && !options.aiDriver) {
    throw new Error('runShipCheck needs a model (or --no-ai)');
  }
  const budget = new LlmBudget({
    deadline,
    ...(options.maxLlmCalls !== undefined ? { maxCalls: options.maxLlmCalls } : {}),
  });
  const cdpPort = useAi && !options.aiDriver ? await freePort() : undefined;

  /**
   * Runs one named check with a timeout, inside the global time budget, and records whether its
   * area of the coverage table was really tested.
   */
  const step = async (
    label: string,
    area: CoverageArea | null, // page speed is not one of the table's areas
    work: () => Promise<CheckResult> | CheckResult,
  ) => {
    const mark = (outcome: Outcome) => {
      if (area) coverage.mark(area, outcome);
    };
    const blocked = (reason: string, advice: string): Outcome => ({
      state: 'not-tested',
      note: withAdvice(noteFor(reason), advice),
    });
    // Areas made of several checks (basic security) say which one is missing.
    const noteFor = (reason: string) => (area === 'security' ? `${label}: ${reason}` : reason);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      mark(blocked('the time limit was reached', ADVICE.time));
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
      // Untested only when the check could say nothing but "not tested" — a page without
      // links, for example, was checked and simply had nothing to report.
      const ran =
        result.findings.length > 0 || result.passed.length > 0 || result.notTested.length === 0;
      mark(
        ran
          ? { state: 'tested' }
          : blocked(reasonOf(result.notTested[0] ?? 'nothing could be checked'), ADVICE.byHand),
      );
      progress(`${label}… ${summarize(result)}`);
    } catch {
      mark(blocked('this check could not finish', ADVICE.retry));
      collector.notTested.push(`${label} — this check could not finish`);
      progress(`${label}… could not finish`);
    }
  };

  const session = await BrowserSession.launch({
    targetUrl: config.url,
    headed: config.headed,
    evidence,
    ...(cdpPort ? { cdpPort } : {}),
  });
  let ai: AiDriver | undefined;
  let landingLoaded: boolean;
  try {
    const desktop = await session.open(DESKTOP);
    const userAgent = session.userAgentFor(DESKTOP);
    const fetchOptions = { lock: session.lock, userAgent };

    const landing = await openLanding(desktop, config.url, evidence, collector, progress);
    landingLoaded = landing !== undefined;
    if (landing) {
      const { facts, headers, finalUrl } = landing;
      const origin = new URL(finalUrl).origin;
      const pages: PageFacts[] = [facts];
      const a11y: A11yViolation[] = [];
      let a11yPages = 0;

      await step('Secure connection (HTTPS)', 'security', () =>
        checkHttps({
          targetUrl: config.url,
          finalUrl,
          insecureRequests: evidence.events.flatMap((e) =>
            e.kind === 'insecure-request' ? [e.url] : [],
          ),
        }),
      );
      await step('Security settings', 'security', () => checkHeaders({ url: finalUrl, headers }));
      await step('Page speed', null, async () =>
        checkPerformance({ url: finalUrl, ...(await collectTimings(desktop.page)) }),
      );

      const rawHtml = await safeFetch(finalUrl, fetchOptions);
      await step('Search engine basics (SEO)', 'seo', async () => {
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
      const second = facts.links
        .map((link) => link.href)
        .find(
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
      await step('Accessibility basics', 'accessibility', () => checkA11y(a11y, a11yPages));

      await step('Exposed secret keys', 'security', async () => {
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

      await step('Broken links and images', 'links', () =>
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

    if (useAi && landing) {
      try {
        ai =
          options.aiDriver?.(budget) ??
          (await createStagehandDriver({
            cdpPort: cdpPort as number,
            model: options.model as ModelChoice,
            budget,
          }));
      } catch {
        collector.partial = true;
        collector.notTested.push(
          'Signing up, logging in, the main feature and forms — the AI tester could not start',
        );
        for (const area of USER_AREAS) {
          coverage.mark(area, {
            state: 'not-tested',
            note: withAdvice('the AI tester could not start', ADVICE.key),
          });
        }
        progress('Starting the AI tester… could not start');
      }
    }
    /** Runs flows on one device, each in isolation; login starts from a fresh browser profile. */
    const runFlows = async (
      preset: DevicePreset,
      names: readonly Exclude<FlowName, 'mobile'>[],
      shared: SharedState,
      first: DevicePage,
      before?: (name: Exclude<FlowName, 'mobile'>) => string | undefined,
    ): Promise<FlowResult[]> => {
      const results: FlowResult[] = [];
      let active = first;
      for (const name of names) {
        const skipped = before?.(name);
        if (skipped) {
          collector.partial = true;
          collector.notTested.push(skipped);
          continue;
        }
        if (name === 'login') {
          await active.context.close().catch(() => undefined);
          active = await session.open(preset);
          shared.loggedIn = false;
        }
        const deps: FlowDeps = {
          page: active.page,
          device: preset.name,
          config,
          ai: ai as AiDriver,
          evidence,
          budget,
          deadline,
          shared,
          homeUrl: (landing as Landing).finalUrl,
          ...(options.guardEnabled === false ? { guardEnabled: false } : {}),
        };
        const result = await runFlow(name, deps, FLOWS[name]);
        results.push(result);
        for (const line of result.notTested) {
          if (!collector.notTested.includes(line)) collector.notTested.push(line);
        }
        if (result.status !== 'completed') collector.partial = true;
        const label = `${FLOW_LABEL[name]}${preset.name === 'mobile' ? ' on a phone' : ''}`;
        progress(`${label}… ${flowSummary(result)}`);
      }
      await active.context.close().catch(() => undefined);
      return results;
    };

    const desktopResults: FlowResult[] = [];
    let shared: SharedState = { loggedIn: false };
    if (ai && landing) {
      desktopResults.push(...(await runFlows(DESKTOP, config.flows, shared, desktop)));
      for (const area of ['signup', 'login', 'core', 'forms'] as const) {
        const result = desktopResults.find((r) => r.name === area);
        if (!config.flows.includes(area))
          coverage.mark(area, { state: 'skipped', note: USED_FLOWS });
        else if (result) coverage.mark(area, flowOutcome(result));
      }
      for (const result of desktopResults) {
        for (const observation of result.observations) {
          if (observation.ok) collector.passed.push(observation.title);
          else {
            const finding = toFinding(observation);
            if (!collector.findings.some((f) => f.id === finding.id)) {
              collector.findings.push(finding);
            }
          }
        }
      }
    }

    // The phone-sized pass (SPEC §6.1 flow 6). Layout checks need no AI; flows run if they can.
    if (landing && !config.skipMobile && Date.now() < deadline) {
      const phone = await session.open(MOBILE);
      await step('Phone layout', 'phone-layout', () =>
        phoneLayout(phone, landing.finalUrl, facts(landing), session, evidence, options),
      );
      if (ai) {
        shared = { loggedIn: false, ...(shared.account ? { account: shared.account } : {}) };
        const names = PHONE_FLOWS.filter((name) => config.flows.includes(name));
        const skippedOnPhone = new Map<string, string>();
        const phoneResults = await runFlows(MOBILE, names, shared, phone, (name) => {
          if (budget.remaining >= PHONE_FLOW_MIN_CALLS) return undefined;
          const reason = `ShipCheck reached its limit of ${budget.maxCalls} AI calls for one run`;
          skippedOnPhone.set(name, withAdvice(reason, ADVICE.calls));
          return `${FLOW_LABEL[name]} on a phone — skipped to stay within the limit of ${budget.maxCalls} AI calls for one run`;
        });
        mergePhoneResults(phoneResults, desktopResults, collector);
        coverage.mark(
          'phone-flows',
          names.length === 0
            ? { state: 'skipped', note: USED_FLOWS }
            : phoneOutcome(
                names.map((name) => {
                  const result = phoneResults.find((r) => r.name === name);
                  const label = name === 'landing' ? 'Landing page' : AREA_LABEL[name];
                  // What the app does not have on desktop, it does not have on a phone either
                  // (there the link may only be hidden in a menu): never "not tested".
                  const desktop = desktopResults.find((r) => r.name === name);
                  const onDesktop = desktop ? flowOutcome(desktop) : undefined;
                  if (onDesktop?.state === 'absent') return { label, ...onDesktop };
                  return result
                    ? { label, ...flowOutcome(result) }
                    : { label, state: 'not-tested' as const, note: skippedOnPhone.get(name) };
                }),
              ),
        );
      } else {
        await phone.context.close().catch(() => undefined);
      }
    }

    // Last, because it looks at everything that happened during the run. Errors caused by
    // ShipCheck's own blocking are taken out first: they are never the app's fault.
    // An app that did not open was not watched for errors: saying "✓" here would contradict
    // the report, which shows this part as not tested.
    if (landingLoaded) {
      await step('Hidden errors', 'errors', () =>
        checkErrors(separateShipCheckBlocking(evidence.events).app),
      );
    } else {
      progress('Hidden errors… not checked (your app did not open)');
    }

    // The judge (SPEC §8 step 7): no evidence → no finding, near-duplicates merged, and — in a
    // full check — one model call that rewords what the AI saw into plain English.
    budget.setFlow('judge');
    const driver = ai;
    const judged = await judge(
      collector.findings,
      driver ? (instruction, schema) => driver.ask(instruction, schema) : undefined,
    );
    collector.findings.splice(0, collector.findings.length, ...judged.findings);
    for (const title of judged.withoutEvidence) {
      collector.notTested.push(
        `A possible problem (“${title}”) — left out of the report, because ShipCheck has no evidence for it`,
      );
    }
    const worked = [...new Set(collector.passed)];
    collector.passed.splice(0, collector.passed.length, ...worked);
    if (driver)
      progress(`Writing up the findings… ${judged.reworded > 0 ? '✓' : 'kept as recorded'}`);
  } finally {
    await ai?.close();
    await session.close();
  }

  if (config.noAi) {
    collector.notTested.push(
      `Signing up, logging in, the main feature and forms, on desktop and on a phone — these need the full check (this run was automatic checks only)${config.skipMobile ? '' : '. The phone layout was checked'}`,
    );
  } else {
    const left = (['landing', 'signup', 'login', 'core', 'forms'] as const).filter(
      (name) => !config.flows.includes(name),
    );
    if (left.length > 0) {
      collector.notTested.push(
        `${left.map((name) => FLOW_LABEL[name]).join(', ')} — left out with --flows`,
      );
    }
  }
  if (config.skipMobile) {
    collector.notTested.push('The phone-sized pass — left out with --skip-mobile');
  }
  collector.notTested.push(
    ...describeBlocking(evidence.events, separateShipCheckBlocking(evidence.events).ours.length),
  );
  const llm = useAi ? budget.summary() : undefined;

  if (!landingLoaded) {
    coverage.failAll(withAdvice('the home page did not load', ADVICE.fixHome));
  }
  const findings = rankFindings(collector.findings);
  const covered = coverage.build(findings, (area) => {
    if (USER_AREAS.includes(area) && config.noAi) {
      return { state: 'not-tested', note: NEEDS_FULL_CHECK };
    }
    if ((area === 'phone-flows' || area === 'phone-layout') && config.skipMobile) {
      return { state: 'skipped', note: 'you used --skip-mobile' };
    }
    return {
      state: 'not-tested',
      note: withAdvice('ShipCheck ran out of time before this part', ADVICE.time),
    };
  });
  const mode = useAi ? 'full' : 'no-ai';
  const report: Report = {
    meta: {
      url: config.url,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      model: useAi ? (options.model?.stagehandModel ?? 'scripted') : null,
      shipcheckVersion: VERSION,
      mode,
      partial: collector.partial,
      llmCalls: llm?.total ?? 0,
      ...(llm ? { llmCallsByFlow: llm.byFlow, llmCallLimit: llm.max } : {}),
    },
    verdict: computeVerdict(findings, { mode, coverage: covered }),
    counts: countBySeverity(findings),
    findings,
    passed: collector.passed,
    notTested: collector.notTested,
    coverage: covered,
    actionLog: evidence.actionLog,
  };
  return {
    // Scrubbed here, so that every consumer — files, step summary, terminal — is safe (§7.6).
    report: redactDeep(report, (text) => evidence.redact(text)),
    screenshots: evidence.screenshots,
    redact: (text) => evidence.redact(text),
    ...(llm ? { llm } : {}),
  };
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

const facts = (landing: Landing): PageFacts => landing.facts;

/**
 * Phone layout checks: the home page and up to five pages linked from it (menu and main buttons
 * first), each opened at iPhone size. A banner covering a button is closed once with a safe
 * choice, if it has one. Each distinct menu button (same header = same menu) is tapped once.
 */
async function phoneLayout(
  phone: DevicePage,
  homeUrl: string,
  home: PageFacts,
  session: BrowserSession,
  evidence: Evidence,
  options: RunOptions,
): Promise<CheckResult> {
  evidence.setScope('mobile');
  try {
    const rank = { navigation: 0, 'call-to-action': 1, other: 2 } as const;
    const seen = new Set([new URL(homeUrl).pathname]);
    const extra: string[] = [];
    const links = [...home.links].sort((a, b) => rank[linkPlacement(a)] - rank[linkPlacement(b)]);
    for (const link of links) {
      if (extra.length >= PHONE_LAYOUT_EXTRA_PAGES) break;
      let url: URL;
      try {
        url = new URL(link.href);
      } catch {
        continue;
      }
      url.hash = '';
      if (!session.lock.isAllowed(url.href) || isRiskyUrl(url.href) || seen.has(url.pathname)) {
        continue;
      }
      seen.add(url.pathname);
      extra.push(url.href);
    }

    const checked: CheckedPage[] = [];
    const menu: CheckResult = { findings: [], passed: [], notTested: [] };
    const menusSeen = new Set<string>();
    for (const url of [homeUrl, ...extra]) {
      let status: number | null = null;
      try {
        status = (await gotoWithRetry(phone.page, url))?.status() ?? null;
      } catch {
        status = null;
      }
      evidence.logAction({
        device: 'mobile',
        flow: 'mobile',
        intent: 'Open the page on a phone to check its layout',
        action: 'goto',
        url,
        result: status !== null && status < 400 ? 'ok' : 'failed',
      });
      if (status === null || status >= 400) continue; // broken pages are the link check's job
      const pageFacts = await collectLayoutFacts(phone.page);
      const problem =
        pageFacts.pageWidth > pageFacts.screenWidth + 1 ||
        pageFacts.cutOff.length + pageFacts.covered.length + pageFacts.tooSmall.length > 0;
      // Screenshot first, so a banner that is closed next still shows on it.
      const shot = problem
        ? await evidence.screenshot(phone.page, 'mobile', `layout ${new URL(url).pathname}`)
        : undefined;
      const judged =
        pageFacts.covered.length > 0
          ? await dismissCoveringBanners(phone.page, pageFacts, {
              device: 'mobile',
              evidence,
              ...(options.guardEnabled === false ? { guardEnabled: false } : {}),
            })
          : pageFacts;
      checked.push({ facts: judged, ...(shot ? { screenshot: shot.file } : {}) });
      // Every visited page, but each distinct menu (same header = same menu) only once.
      const result = await checkPhoneMenu(phone.page, {
        device: 'mobile',
        evidence,
        seen: menusSeen,
        ...(url === homeUrl ? {} : { pagePath: new URL(url).pathname }),
        ...(options.guardEnabled === false ? { guardEnabled: false } : {}),
      });
      menu.findings.push(...result.findings);
      for (const line of result.passed) if (!menu.passed.includes(line)) menu.passed.push(line);
      for (const line of result.notTested) {
        if (!menu.notTested.includes(line)) menu.notTested.push(line);
      }
    }
    const layout = judgeLayout(checked);
    return {
      findings: [...layout.findings, ...menu.findings],
      passed: [...layout.passed, ...menu.passed],
      notTested: [...layout.notTested, ...menu.notTested],
    };
  } finally {
    evidence.setScope(undefined);
  }
}

/**
 * Folds the phone flows into the report. The same problem on both devices becomes one finding
 * for "both"; a problem only seen on the phone becomes a phone finding, never a desktop one.
 */
function mergePhoneResults(
  phone: readonly FlowResult[],
  desktop: readonly FlowResult[],
  collector: Collector,
): void {
  for (const result of phone) {
    const onDesktop = desktop.find((d) => d.name === result.name);
    for (const observation of result.observations) {
      if (observation.ok) {
        const line = `${observation.title} on a phone`;
        if (!collector.passed.includes(line)) collector.passed.push(line);
        continue;
      }
      const index = collector.findings.findIndex(
        (f) => f.rule === observation.rule && f.device === 'desktop',
      );
      const same = collector.findings[index];
      if (same) {
        if (observation.severity === 'info') continue; // e.g. "Reached payment", already listed
        collector.findings[index] = makeFinding({
          ...same,
          device: 'both',
          evidence: {
            ...same.evidence,
            screenshots: [...same.evidence.screenshots, ...observation.screenshots],
            logs: [...(same.evidence.logs ?? []), 'The same happens on a phone (iPhone, 390×844)'],
          },
        });
        continue;
      }
      const worksOnDesktop =
        onDesktop?.status === 'completed' &&
        onDesktop.observations.some((o) => o.ok) &&
        !onDesktop.observations.some((o) => !o.ok && o.severity !== 'info');
      const finding = toFinding(
        {
          ...observation,
          flow: 'mobile',
          category: observation.category === 'coverage' ? 'coverage' : 'mobile',
          title: `${observation.title} on a phone`,
          actual: `On a phone-sized screen (iPhone, 390×844): ${observation.actual}${
            worksOnDesktop ? ' On a desktop screen the same steps work.' : ''
          }`,
          steps: [
            'Use a phone, or Chrome’s phone view (right-click → Inspect → the phone icon).',
            ...observation.steps,
          ],
        },
        'mobile',
      );
      if (!collector.findings.some((f) => f.id === finding.id)) collector.findings.push(finding);
    }
  }
}
