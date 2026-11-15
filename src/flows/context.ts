import { randomBytes } from 'node:crypto';
import type { Page } from 'playwright';
import type { z } from 'zod';
import { BudgetExceededError, QuotaExhaustedError } from '../ai/budget.js';
import { detectPayment, readElementFacts } from '../browser/element.js';
import { judgeAction, type ElementFacts, type ProposedAction } from '../browser/guard.js';
import { gotoWithRetry } from '../browser/session.js';
import {
  MAX_FLOW_STEPS,
  type FlowDeps,
  type FlowName,
  type FlowResult,
  type Gap,
  type Observation,
} from './types.js';
import { reasonOf } from '../coverage.js';
import { ADVICE } from '../report/present.js';

const SETTLE_MS = 3000;
const QUIET_MS = 350;

/** Ends a flow early on purpose. `note` is the line for "What we couldn't test". */
export class StopFlow extends Error {
  override name = 'StopFlow';
  constructor(
    readonly reason: 'payment' | 'budget' | 'steps' | 'blocked-request' | 'quota',
    readonly note: string,
  ) {
    super(note);
  }
}

export type PerformResult =
  | { status: 'ok'; facts: ElementFacts | null }
  | { status: 'failed'; facts: ElementFacts | null; message: string }
  | { status: 'blocked'; facts: ElementFacts | null; reason: string };

/** What a page looks like at one moment, to tell whether an action changed anything. */
export interface Snapshot {
  url: string;
  text: string;
  /** Size of the page's markup: catches changes that add no visible text. */
  size: number;
  pages: number;
}

export const FLOW_LABEL: Record<FlowName, string> = {
  landing: 'Landing page',
  signup: 'Signing up',
  login: 'Logging in',
  core: 'Main feature',
  forms: 'Forms',
  mobile: 'Phone-sized pass',
};

const randomId = (): string => randomBytes(4).toString('hex');

/** A generated test identity (SPEC §6.1). example.com can never deliver mail to a real person. */
export function newIdentity(): { email: string; password: string; name: string } {
  return {
    email: `shipcheck+${randomId()}@example.com`,
    password: `Sc-${randomId()}-${randomId()}!9a`,
    name: 'ShipCheck Tester',
  };
}

/**
 * Everything a flow needs, with the safety rules built in: every action goes
 * observe → guard → act, is counted against the step limit and written to the action log.
 */
export class FlowContext {
  readonly observations: Observation[] = [];
  readonly notTested: string[] = [];
  private readonly gaps: Gap[] = [];
  steps = 0;

  constructor(
    readonly flow: FlowName,
    private readonly deps: FlowDeps,
  ) {}

  get page(): Page {
    return this.deps.page;
  }
  get config(): FlowDeps['config'] {
    return this.deps.config;
  }
  get shared(): FlowDeps['shared'] {
    return this.deps.shared;
  }
  get evidence(): FlowDeps['evidence'] {
    return this.deps.evidence;
  }
  get homeUrl(): string {
    return this.deps.homeUrl;
  }
  get device(): FlowDeps['device'] {
    return this.deps.device;
  }

  /** "Signing up", or "Signing up on a phone" during the phone-sized pass. */
  get label(): string {
    return `${FLOW_LABEL[this.flow]}${this.deps.device === 'mobile' ? ' on a phone' : ''}`;
  }

  private checkLimits(): void {
    if (Date.now() >= this.deps.deadline) {
      throw new StopFlow(
        'budget',
        `${this.label} — the time limit of ${this.config.maxMinutes} minutes was reached`,
      );
    }
    if (this.steps >= MAX_FLOW_STEPS) {
      throw new StopFlow(
        'steps',
        `${this.label} — stopped after ${MAX_FLOW_STEPS} steps without finishing`,
      );
    }
  }

  private translate(error: unknown): never {
    if (error instanceof QuotaExhaustedError) {
      throw new StopFlow(
        'quota',
        `${this.label} — your AI key’s quota ran out (the AI service kept answering “too many requests”)`,
      );
    }
    if (error instanceof BudgetExceededError) {
      throw new StopFlow(
        'budget',
        error.limit === 'calls'
          ? `${this.label} — the limit of ${this.deps.budget.maxCalls} AI calls for one run was reached`
          : `${this.label} — the time limit of ${this.config.maxMinutes} minutes was reached`,
      );
    }
    throw error;
  }

  /** Asks the AI to find elements. It only looks; nothing on the page is touched. */
  async observe(instruction: string): Promise<ProposedAction[]> {
    this.checkLimits();
    try {
      return await this.deps.ai.observe(this.page, instruction);
    } catch (error) {
      return this.translate(error);
    }
  }

  /** Asks the AI to describe what is visible. */
  async extract<T extends z.ZodObject>(instruction: string, schema: T): Promise<z.infer<T>> {
    this.checkLimits();
    try {
      return await this.deps.ai.extract(this.page, instruction, schema);
    } catch (error) {
      return this.translate(error);
    }
  }

  private async stopIfPayment(): Promise<void> {
    const payment = await detectPayment(this.page);
    if (!payment) return;
    const shot = await this.shot('payment page');
    this.observations.push({
      flow: this.flow,
      rule: 'coverage/reached-payment',
      ok: false,
      title: 'Reached payment — stopped by design',
      expected: 'ShipCheck never enters card details or completes a payment.',
      actual: `The page shows ${payment}, so testing stopped here.`,
      severity: 'info',
      category: 'coverage',
      whyItMatters:
        'Paying with a real card is something only you should do. Test the payment step yourself with your payment provider’s test mode.',
      steps: [`Open ${this.page.url()}.`],
      screenshots: shot ? [shot] : [],
      logs: [`Payment step found on ${this.page.url()}`],
      url: this.page.url(),
      confidence: 'verified',
    });
    throw new StopFlow(
      'payment',
      'Payment — reached the payment step and stopped before paying (by design)',
    );
  }

  /**
   * Performs one action the AI proposed — after the guard has approved exactly this action.
   * The same object the guard judged is handed to the browser; nothing is re-interpreted.
   */
  async perform(action: ProposedAction, intent: string): Promise<PerformResult> {
    this.checkLimits();
    await this.stopIfPayment();
    this.steps += 1;

    const facts = await readElementFacts(this.page, action.selector);
    const verdict =
      this.deps.guardEnabled === false ? { allowed: true as const } : judgeAction(action, facts);
    const secret =
      facts?.type === 'password' ||
      /pass(word|wort|phrase)|kennwort/i.test(`${facts?.name ?? ''} ${facts?.label ?? ''}`);
    const value = action.arguments?.[0];
    // Whatever is typed into a password field — also a password the AI made up by itself — is
    // scrubbed from every output (SPEC §7.6), including text written before this point.
    if (secret) this.evidence.protect(value);
    const logged = {
      device: this.deps.device,
      flow: this.flow,
      intent,
      action: action.method ?? 'unknown',
      locator: action.selector,
      url: this.page.url(),
      ...(value !== undefined ? { value: secret ? '[hidden]' : value.slice(0, 200) } : {}),
    };
    if (!verdict.allowed) {
      this.evidence.logAction({ ...logged, result: 'blocked', detail: verdict.reason });
      return { status: 'blocked', facts, reason: verdict.reason };
    }

    const stopsBefore = this.blockedActions();
    let outcome: { success: boolean; message: string };
    try {
      outcome = await this.deps.ai.act(this.page, action);
    } catch (error) {
      outcome = { success: false, message: error instanceof Error ? error.message : 'failed' };
    }
    await this.settle();
    this.evidence.logAction({
      ...logged,
      result: outcome.success ? 'ok' : 'failed',
      ...(outcome.success ? {} : { detail: outcome.message.split('\n')[0] ?? 'failed' }),
    });

    if (this.blockedActions().length > stopsBefore.length) {
      const blocked = this.blockedActions().at(-1);
      throw new StopFlow(
        'blocked-request',
        `${this.label} — stopped by design: the last step tried to send ${
          blocked?.kind === 'blocked-request'
            ? blocked.reason
            : 'a request ShipCheck does not allow'
        }, and ShipCheck blocked it`,
      );
    }
    await this.stopIfPayment();
    return outcome.success
      ? { status: 'ok', facts }
      : { status: 'failed', facts, message: outcome.message };
  }

  /**
   * Blocked requests that mean "this step tried to do something not allowed" and so end the
   * flow: deletes, card numbers, and opening a payment provider's page. A payment script
   * phoning home in the background (Stripe.js does this on every page) is still blocked, but
   * it is not the step's doing, so the flow carries on.
   */
  private blockedActions() {
    return this.evidence.events.filter(
      (e): e is Extract<typeof e, { kind: 'blocked-request' }> =>
        e.kind === 'blocked-request' && (e.cause !== 'payment-host' || e.topLevel),
    );
  }

  /** Waits for the page to calm down after an action (never longer than a few seconds). */
  async settle(): Promise<void> {
    await this.page
      .waitForLoadState('domcontentloaded', { timeout: SETTLE_MS })
      .catch(() => undefined);
    await this.page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
    await this.page.waitForTimeout(QUIET_MS).catch(() => undefined);
  }

  /**
   * Waits until the page has moved to another address, at most `capMs`. For apps that show a
   * loading label after a successful request and only then move on: judging before that would
   * call a working step broken (lesson from a real-app run, SPEC §13 2026-11-15).
   */
  async waitForAddressChange(from: string, capMs: number): Promise<boolean> {
    const end = Math.min(Date.now() + capMs, this.deps.deadline);
    while (Date.now() < end) {
      if (this.page.url() !== from) {
        await this.settle();
        return true;
      }
      await this.page.waitForTimeout(250).catch(() => undefined);
    }
    return this.page.url() !== from;
  }

  async snapshot(): Promise<Snapshot> {
    const pages = this.page.context().pages().length;
    try {
      const { text, size } = await this.page.evaluate(() => ({
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        size: document.body?.innerHTML.length ?? 0,
      }));
      return { url: this.page.url(), text, size, pages };
    } catch {
      return { url: this.page.url(), text: '', size: 0, pages };
    }
  }

  /** Text that is visible now but was not before — usually the message an action produced. */
  static newText(before: Snapshot, after: Snapshot): string {
    if (after.text === before.text) return '';
    let start = 0;
    while (start < before.text.length && before.text[start] === after.text[start]) start += 1;
    let endB = before.text.length;
    let endA = after.text.length;
    while (endB > start && endA > start && before.text[endB - 1] === after.text[endA - 1]) {
      endB -= 1;
      endA -= 1;
    }
    return after.text.slice(start, endA).trim().slice(0, 300);
  }

  static changed(before: Snapshot, after: Snapshot): boolean {
    return (
      before.url !== after.url ||
      before.text !== after.text ||
      before.size !== after.size ||
      before.pages !== after.pages
    );
  }

  async shot(label: string): Promise<string | undefined> {
    return (await this.evidence.screenshot(this.page, this.deps.device, `${this.flow} ${label}`))
      ?.file;
  }

  /** Opens an address of the app itself and logs it. Returns the HTTP status, or null. */
  async goto(url: string, intent: string): Promise<number | null> {
    this.checkLimits();
    const status = await gotoWithRetry(this.page, url)
      .then((response) => response?.status() ?? null)
      .catch(() => null);
    await this.settle();
    this.evidence.logAction({
      device: this.deps.device,
      flow: this.flow,
      intent,
      action: 'goto',
      url,
      result: status !== null && status < 400 ? 'ok' : 'failed',
    });
    return status;
  }

  /** Closes tabs the app opened, so every step starts from the one page under test. */
  async closeExtraPages(): Promise<void> {
    for (const other of this.page.context().pages()) {
      if (other !== this.page) await other.close().catch(() => undefined);
    }
  }

  record(observation: Omit<Observation, 'flow'>): void {
    this.observations.push({ flow: this.flow, ...observation });
  }

  /**
   * Adds a line for "What we couldn't test". On the phone, "Signing up — …" gets "on a phone".
   * `gap` says what kind of gap it is (default: something blocked the test) and, for a blocked
   * test, what the user can do; `reason` replaces the reason taken from the line.
   */
  skip(line: string, gap: Partial<Gap> = {}): void {
    this.gaps.push({
      kind: gap.kind ?? 'blocked',
      reason: gap.reason ?? reasonOf(line),
      ...(gap.action ? { action: gap.action } : {}),
    });
    this.notTested.push(
      this.deps.device === 'mobile' && !/^[^—]* on a phone — /.test(line)
        ? line.replace(/^([^—]+?) — /, '$1 on a phone — ')
        : line,
    );
  }

  result(status: FlowResult['status']): FlowResult {
    return {
      name: this.flow,
      status,
      observations: this.observations,
      notTested: this.notTested,
      gaps: this.gaps,
      steps: this.steps,
    };
  }
}

/** What the user can do when a flow was stopped on purpose. */
const STOP_ADVICE: Record<StopFlow['reason'], (note: string) => string> = {
  payment: () => ADVICE.payment,
  budget: (note) => (note.includes('AI calls') ? ADVICE.calls : ADVICE.time),
  steps: () => ADVICE.byHand,
  'blocked-request': () => ADVICE.byHand,
  quota: () => ADVICE.quota,
};

export type FlowBody = (ctx: FlowContext) => Promise<void>;

/**
 * Runs one flow in isolation (SPEC §8): a planned stop or an unexpected failure ends this flow
 * only, is listed under "What we couldn't test", and the run carries on.
 */
export async function runFlow(name: FlowName, deps: FlowDeps, body: FlowBody): Promise<FlowResult> {
  const ctx = new FlowContext(name, deps);
  // Phone flows share one line in the AI call count ("mobile"), as the spec lists flow 6.
  deps.budget.setFlow(deps.device === 'mobile' ? 'mobile' : name);
  deps.evidence.setScope(deps.device === 'mobile' ? `mobile ${name}` : name);
  try {
    await ctx.shot('start');
    await body(ctx);
    await ctx.shot('end');
    return ctx.result('completed');
  } catch (error) {
    await ctx.shot('stopped').catch(() => undefined);
    if (error instanceof StopFlow) {
      // Stopping before a payment is by design, not a gap in the test (owner decision 2026-11-15).
      ctx.skip(
        error.note,
        error.reason === 'payment'
          ? { kind: 'payment', reason: 'stopped before payment' }
          : { action: STOP_ADVICE[error.reason](error.note) },
      );
      return ctx.result('stopped');
    }
    ctx.skip(`${ctx.label} — this part of the test could not finish`, { action: ADVICE.retry });
    if (process.env.SHIPCHECK_DEBUG) console.error(error);
    return ctx.result('failed');
  } finally {
    await ctx.closeExtraPages().catch(() => undefined);
    deps.evidence.setScope(undefined);
  }
}
