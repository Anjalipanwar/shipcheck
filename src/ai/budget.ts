/**
 * Counts every real request to the AI model and enforces the run's limits (SPEC §7.4).
 * It is plugged into the AI SDK underneath Stagehand, so nothing can call the model around it:
 * hidden extra calls and retries are counted too.
 */

export const DEFAULT_MAX_LLM_CALLS = 150;
/**
 * Pauses after a "too many requests" answer. Free AI keys allow only a few requests per minute,
 * so the pauses add up to more than a minute: by then the per-minute window has passed. (In a
 * real run, two short retries were not enough and the main feature was never tested.)
 */
const RETRY_PAUSES_MS = [5_000, 15_000, 30_000, 45_000];
/** After the first "too many requests", the rest of the run leaves this gap between calls. */
const SLOW_GAP_MS = 4_000;
/** A limit per day does not pass by waiting a minute. */
const DAILY_LIMIT = /per ?day|daily|PerDay/i;

export class BudgetExceededError extends Error {
  override name = 'BudgetExceededError';
  constructor(readonly limit: 'calls' | 'time') {
    super(limit === 'calls' ? 'AI call limit reached' : 'time limit reached');
  }
}

/** The AI provider keeps answering "too many requests": the key's quota is used up. */
export class QuotaExhaustedError extends Error {
  override name = 'QuotaExhaustedError';
  constructor() {
    super('AI quota exhausted');
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { statusCode, status, message } = error as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (statusCode === 429 || status === 429) return true;
  return (
    typeof message === 'string' &&
    /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota|too many requests/i.test(message)
  );
}

export interface BudgetOptions {
  maxCalls?: number;
  /** Point in time (ms since epoch) after which no call may start. */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface BudgetSummary {
  total: number;
  max: number;
  byFlow: Record<string, number>;
}

/** Shape of the AI SDK middleware Stagehand accepts (LanguageModelV2Middleware). */
export interface CallCountingMiddleware {
  middlewareVersion: 'v2';
  wrapGenerate: (options: { doGenerate: () => PromiseLike<unknown> }) => Promise<unknown>;
  wrapStream: (options: { doStream: () => PromiseLike<unknown> }) => Promise<unknown>;
}

export class LlmBudget {
  readonly maxCalls: number;
  private total = 0;
  private readonly byFlow = new Map<string, number>();
  private flow = 'setup';
  private slow = false;
  private lastCall = Number.NEGATIVE_INFINITY;
  private readonly deadline: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: BudgetOptions) {
    this.maxCalls = options.maxCalls ?? DEFAULT_MAX_LLM_CALLS;
    this.deadline = options.deadline;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  /** Names the flow that the following calls are counted under. */
  setFlow(name: string): void {
    this.flow = name;
  }

  get used(): number {
    return this.total;
  }

  get remaining(): number {
    return Math.max(0, this.maxCalls - this.total);
  }

  /** Throws if another call is not allowed; does not count anything. */
  check(): void {
    if (this.now() >= this.deadline) throw new BudgetExceededError('time');
    if (this.total >= this.maxCalls) throw new BudgetExceededError('calls');
  }

  /** Registers one call that is about to be sent. Throws instead if the budget is used up. */
  take(): void {
    this.check();
    this.total += 1;
    this.byFlow.set(this.flow, (this.byFlow.get(this.flow) ?? 0) + 1);
  }

  /**
   * Sends one model request through the budget. "Too many requests" answers are retried up to
   * four times with growing, randomised pauses (SPEC §8), and the run slows down afterwards;
   * every attempt counts as a call.
   */
  async run<T>(call: () => PromiseLike<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      // Once the service has complained, keep a gap between calls for the rest of the run.
      const wait = this.lastCall + SLOW_GAP_MS - this.now();
      if (this.slow && attempt === 0 && wait > 0 && this.now() + wait < this.deadline) {
        await this.sleep(wait);
      }
      this.take();
      this.lastCall = this.now();
      try {
        return await call();
      } catch (error) {
        if (!isRateLimitError(error)) throw error;
        this.slow = true;
        const base = RETRY_PAUSES_MS[attempt];
        const message = (error as { message?: unknown }).message;
        const daily = typeof message === 'string' && DAILY_LIMIT.test(message);
        const pause = (base ?? 0) * (0.75 + this.random() / 2);
        if (base === undefined || daily || this.now() + pause >= this.deadline) {
          throw new QuotaExhaustedError();
        }
        await this.sleep(pause);
      }
    }
  }

  readonly middleware: CallCountingMiddleware = {
    middlewareVersion: 'v2',
    wrapGenerate: ({ doGenerate }) => this.run(doGenerate),
    wrapStream: ({ doStream }) => this.run(doStream),
  };

  summary(): BudgetSummary {
    return { total: this.total, max: this.maxCalls, byFlow: Object.fromEntries(this.byFlow) };
  }
}
