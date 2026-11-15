import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  LlmBudget,
  QuotaExhaustedError,
  isRateLimitError,
} from '../../../src/ai/budget.js';

const budget = (overrides: Partial<ConstructorParameters<typeof LlmBudget>[0]> = {}) => {
  const clock = { now: 0 };
  const pauses: number[] = [];
  const instance = new LlmBudget({
    deadline: 600_000,
    now: () => clock.now,
    sleep: async (ms) => {
      pauses.push(ms);
      clock.now += ms;
    },
    random: () => 0.5,
    ...overrides,
  });
  return { instance, clock, pauses };
};
const tooMany = () => Object.assign(new Error('Too Many Requests'), { statusCode: 429 });

describe('LlmBudget', () => {
  it('counts every call, in total and per flow', async () => {
    const { instance } = budget();
    await instance.run(async () => 'a');
    instance.setFlow('login');
    await instance.run(async () => 'b');
    await instance.run(async () => 'c');
    instance.setFlow('forms');
    await instance.run(async () => 'd');
    expect(instance.summary()).toEqual({
      total: 4,
      max: 150,
      byFlow: { setup: 1, login: 2, forms: 1 },
    });
    expect(instance.used).toBe(4);
    expect(instance.remaining).toBe(146);
  });

  it('refuses the call that would go over the limit — the model is never reached', async () => {
    const { instance } = budget({ maxCalls: 2 });
    let reached = 0;
    const call = async () => (reached += 1);
    await instance.run(call);
    await instance.run(call);
    await expect(instance.run(call)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(instance.run(call)).rejects.toMatchObject({ limit: 'calls' });
    expect(reached).toBe(2);
    expect(instance.used).toBe(2);
    expect(() => instance.check()).toThrow(BudgetExceededError);
  });

  it('refuses calls after the time limit', async () => {
    const { instance, clock } = budget();
    clock.now = 600_000;
    await expect(instance.run(async () => 1)).rejects.toMatchObject({ limit: 'time' });
    expect(instance.used).toBe(0);
  });

  it('counts a failed call too, and passes ordinary errors on unchanged', async () => {
    const { instance } = budget();
    const boom = new Error('boom');
    await expect(instance.run(async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(instance.used).toBe(1);
  });

  it('retries "too many requests" with growing pauses, counting each attempt', async () => {
    const { instance, pauses } = budget();
    let attempts = 0;
    const result = await instance.run(async () => {
      attempts += 1;
      if (attempts < 3) throw tooMany();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(instance.used).toBe(3);
    expect(pauses).toEqual([5000, 15_000]);
  });

  it('gives up with "quota exhausted" when the service keeps refusing', async () => {
    const { instance } = budget();
    let attempts = 0;
    await expect(
      instance.run(async () => {
        attempts += 1;
        throw tooMany();
      }),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(attempts).toBe(5);
    expect(instance.used).toBe(5);
  });

  it('waits longer than a minute in total, so a per-minute limit has passed', async () => {
    const { instance, pauses } = budget();
    await expect(instance.run(async () => Promise.reject(tooMany()))).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(pauses.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(60_000);
  });

  it('a limit per day is not waited for', async () => {
    const { instance, pauses } = budget();
    const daily = Object.assign(new Error('Quota exceeded: GenerateRequestsPerDayPerProject'), {
      statusCode: 429,
    });
    await expect(instance.run(async () => Promise.reject(daily))).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(pauses).toEqual([]);
    expect(instance.used).toBe(1);
  });

  it('after one "too many requests" the rest of the run leaves a gap between calls', async () => {
    const { instance, pauses, clock } = budget();
    let attempts = 0;
    await instance.run(async () => {
      attempts += 1;
      if (attempts === 1) throw tooMany();
      return 'ok';
    });
    pauses.length = 0;
    await instance.run(async () => 'next'); // right after: waits out the gap
    expect(pauses).toEqual([4000]);
    clock.now += 10_000;
    await instance.run(async () => 'later'); // long after: no wait
    expect(pauses).toEqual([4000]);
  });

  it('a run that was never refused is not slowed down', async () => {
    const { instance, pauses } = budget();
    await instance.run(async () => 'a');
    await instance.run(async () => 'b');
    expect(pauses).toEqual([]);
  });

  it('does not wait past the time limit', async () => {
    const { instance, clock, pauses } = budget();
    clock.now = 598_000;
    await expect(instance.run(async () => Promise.reject(tooMany()))).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(pauses).toEqual([]);
  });

  it('counts through the middleware Stagehand calls, for both kinds of model request', async () => {
    const { instance } = budget({ maxCalls: 2 });
    instance.setFlow('core');
    expect(await instance.middleware.wrapGenerate({ doGenerate: async () => 'g' })).toBe('g');
    expect(await instance.middleware.wrapStream({ doStream: async () => 's' })).toBe('s');
    await expect(
      instance.middleware.wrapGenerate({ doGenerate: async () => 'x' }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(instance.summary().byFlow).toEqual({ core: 2 });
    expect(instance.middleware.middlewareVersion).toBe('v2');
  });
});

describe('isRateLimitError', () => {
  it('recognises the providers’ ways of saying "too many requests"', () => {
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('Rate limit reached for requests'))).toBe(true);
  });
  it('does not confuse other failures with it', () => {
    expect(isRateLimitError(new Error('fetch failed'))).toBe(false);
    expect(isRateLimitError({ statusCode: 500 })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError('429')).toBe(false);
  });
});
