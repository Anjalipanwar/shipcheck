import { createServer } from 'node:net';
import { Stagehand } from '@browserbasehq/stagehand';
import type { Page } from 'playwright';
import type { z } from 'zod';
import type { ProposedAction } from '../browser/guard.js';
import type { LlmBudget } from './budget.js';
import type { ModelChoice } from './models.js';

/**
 * The only three things ShipCheck asks of the AI layer. Flows depend on this interface, so they
 * can be tested with a scripted stand-in and no AI key.
 */
export interface AiDriver {
  /** Asks the model to find elements. One AI call. Never touches the page. */
  observe(page: Page, instruction: string): Promise<ProposedAction[]>;
  /**
   * Performs exactly the given action — the one the guard approved. No AI call, and no second
   * attempt on a different element if it fails.
   */
  act(page: Page, action: ProposedAction): Promise<{ success: boolean; message: string }>;
  /** Asks the model to describe what is visible, as data of the given shape. Two AI calls. */
  extract<T extends z.ZodObject>(page: Page, instruction: string, schema: T): Promise<z.infer<T>>;
  /**
   * Asks the model a question that needs no page (the judge's rewording). One AI call, counted
   * and limited like every other.
   */
  ask<T extends z.ZodObject>(instruction: string, schema: T): Promise<z.infer<T>>;
  close(): Promise<void>;
}

const ACT_TIMEOUT_MS = 15_000;
const MAX_OBSERVED = 12;

/** Finds a free local port for the browser's remote-control connection. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/**
 * Connects Stagehand to the browser Playwright already runs (see docs/notes/stagehand.md).
 * `selfHeal: false` matters for safety: with the default, a failed action makes Stagehand ask
 * the model for another element and click that one, which the guard never saw.
 */
export async function createStagehandDriver(options: {
  cdpPort: number;
  model: ModelChoice;
  budget: LlmBudget;
}): Promise<AiDriver> {
  const response = await fetch(`http://127.0.0.1:${options.cdpPort}/json/version`);
  const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
  const stagehand = new Stagehand({
    env: 'LOCAL',
    localBrowserLaunchOptions: { cdpUrl: webSocketDebuggerUrl },
    model: {
      modelName: options.model.stagehandModel,
      apiKey: options.model.apiKey,
      // Every request to the model passes through the budget (counting, limits, retries).
      middleware: options.budget.middleware as never,
    },
    selfHeal: false,
    verbose: 0,
    disablePino: true,
    logger: () => undefined,
  });
  await stagehand.init();

  return {
    async observe(page, instruction) {
      options.budget.check();
      const found = await stagehand.observe(instruction, { page });
      return found.slice(0, MAX_OBSERVED).map((action) => ({
        selector: action.selector,
        description: action.description,
        method: action.method,
        arguments: action.arguments,
      }));
    },
    async act(page, action) {
      const result = await stagehand.act(
        {
          selector: action.selector,
          description: action.description,
          ...(action.method ? { method: action.method } : {}),
          ...(action.arguments ? { arguments: action.arguments } : {}),
        },
        { page, timeout: ACT_TIMEOUT_MS },
      );
      return { success: result.success, message: result.message };
    },
    async extract(page, instruction, schema) {
      options.budget.check();
      return (await stagehand.extract(instruction, schema as never, { page })) as never;
    },
    async ask(instruction, schema) {
      options.budget.check();
      // Stagehand's own client: the AI SDK's generateObject with the model that carries our
      // counting middleware (verified in the installed types, see docs/notes/stagehand.md).
      const client = stagehand.llmClient;
      const model = client.getLanguageModel?.();
      if (!model) throw new Error('this model cannot be asked directly');
      // The SDK's overloads do not resolve for a schema type that is only known at run time.
      const { object } = await client.generateObject({
        model,
        schema,
        prompt: instruction,
      } as never);
      return object as never;
    },
    async close() {
      await stagehand.close().catch(() => undefined);
    },
  };
}
