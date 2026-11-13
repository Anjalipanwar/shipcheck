import { ConfigError } from '../config.js';

/**
 * Which AI model ShipCheck uses, decided from the keys in the environment and the --model flag
 * (SPEC §8). All model defaults live in this file.
 */

export type Provider = 'google' | 'anthropic' | 'openai';

/**
 * Default model per provider.
 * - google: checked on 2026-11-13 against Google's models and pricing pages. "gemini-3.5-flash-lite"
 *   is stable, available on the free tier and described there as "optimized for high-volume
 *   agentic tasks". Google no longer publishes free-tier request limits (they are shown per
 *   project in AI Studio), so ShipCheck keeps its own call count low and stops cleanly when the
 *   quota runs out. Verified with a live run against the fixture app.
 * - anthropic: the current small, fast Claude model. Not yet verified with a live run.
 * - openai: an id from Stagehand's own model list. Not yet verified with a live run.
 */
export const DEFAULT_MODELS: Record<Provider, string> = {
  google: 'gemini-3.5-flash-lite',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4.1-mini',
};

/** Environment variables per provider, in the order they are tried. Gemini first (free tier). */
const KEY_NAMES: readonly [Provider, readonly string[]][] = [
  ['google', ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']],
  ['anthropic', ['ANTHROPIC_API_KEY']],
  ['openai', ['OPENAI_API_KEY']],
];

const PROVIDER_LABEL: Record<Provider, string> = {
  google: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
};

export interface ModelChoice {
  provider: Provider;
  /** Model id without the provider, e.g. "gemini-3.5-flash-lite". */
  modelId: string;
  /** The name Stagehand expects: "<provider>/<model id>". */
  stagehandModel: string;
  apiKey: string;
  /** Name of the environment variable the key came from (never the key itself). */
  keySource: string;
}

export const NO_KEY_MESSAGE = [
  'ShipCheck needs an AI key to use your app like a real visitor. A free one takes a minute:',
  '',
  '  1. Open https://aistudio.google.com/apikey and click “Create API key”.',
  '  2. In the folder where you run ShipCheck, create a file named .env with this one line:',
  '       GEMINI_API_KEY=paste-your-key-here',
  '     (or set it for this terminal only:  export GEMINI_API_KEY=paste-your-key-here)',
  '  3. Run ShipCheck again.',
  '',
  'Keys from Anthropic (ANTHROPIC_API_KEY) and OpenAI (OPENAI_API_KEY) work too.',
  'To run only the automatic checks, which need no key, add --no-ai.',
].join('\n');

function findKey(
  env: Record<string, string | undefined>,
  provider: Provider,
): { apiKey: string; keySource: string } | undefined {
  const names = KEY_NAMES.find(([name]) => name === provider)?.[1] ?? [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { apiKey: value, keySource: name };
  }
  return undefined;
}

function providerOf(model: string): { provider: Provider; modelId: string } | undefined {
  const [prefix, ...rest] = model.split('/');
  if (rest.length > 0) {
    const provider = prefix === 'gemini' ? 'google' : prefix;
    return provider === 'google' || provider === 'anthropic' || provider === 'openai'
      ? { provider, modelId: rest.join('/') }
      : undefined;
  }
  if (/^gemini/i.test(model)) return { provider: 'google', modelId: model };
  if (/^claude/i.test(model)) return { provider: 'anthropic', modelId: model };
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return { provider: 'openai', modelId: model };
  return undefined;
}

/**
 * Picks provider, model and key. Without --model: the first provider that has a key, with its
 * default model. With --model: that model, which then needs its own provider's key.
 */
export function chooseModel(
  env: Record<string, string | undefined>,
  override?: string,
): ModelChoice {
  if (override) {
    const parsed = providerOf(override.trim());
    if (!parsed) {
      throw new ConfigError(
        `ShipCheck does not recognise the model “${override}”. Write it as provider/model, for example google/${DEFAULT_MODELS.google}, anthropic/${DEFAULT_MODELS.anthropic} or openai/${DEFAULT_MODELS.openai}.`,
      );
    }
    const key = findKey(env, parsed.provider);
    if (!key) {
      const names = KEY_NAMES.find(([name]) => name === parsed.provider)?.[1] ?? [];
      throw new ConfigError(
        `The model “${override}” needs a ${PROVIDER_LABEL[parsed.provider]} key, but ${names[0]} is not set.\n\n${NO_KEY_MESSAGE}`,
      );
    }
    return { ...parsed, stagehandModel: `${parsed.provider}/${parsed.modelId}`, ...key };
  }
  for (const [provider] of KEY_NAMES) {
    const key = findKey(env, provider);
    if (key) {
      const modelId = DEFAULT_MODELS[provider];
      return { provider, modelId, stagehandModel: `${provider}/${modelId}`, ...key };
    }
  }
  throw new ConfigError(NO_KEY_MESSAGE);
}
