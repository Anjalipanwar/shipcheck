import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, NO_KEY_MESSAGE, chooseModel } from '../../../src/ai/models.js';
import { ConfigError } from '../../../src/config.js';

describe('chooseModel', () => {
  it('prefers Gemini (free tier), then Anthropic, then OpenAI', () => {
    expect(
      chooseModel({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }),
    ).toEqual({
      provider: 'google',
      modelId: DEFAULT_MODELS.google,
      stagehandModel: `google/${DEFAULT_MODELS.google}`,
      apiKey: 'g',
      keySource: 'GEMINI_API_KEY',
    });
    expect(chooseModel({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).toMatchObject({
      provider: 'anthropic',
      stagehandModel: `anthropic/${DEFAULT_MODELS.anthropic}`,
      keySource: 'ANTHROPIC_API_KEY',
    });
    expect(chooseModel({ OPENAI_API_KEY: 'o' })).toMatchObject({ provider: 'openai', apiKey: 'o' });
  });

  it('accepts GOOGLE_API_KEY as well, and ignores empty values', () => {
    expect(chooseModel({ GEMINI_API_KEY: '  ', GOOGLE_API_KEY: ' g2 ' })).toMatchObject({
      provider: 'google',
      apiKey: 'g2',
      keySource: 'GOOGLE_API_KEY',
    });
  });

  it('without any key: explains in three steps how to get a free one', () => {
    expect(() => chooseModel({})).toThrow(ConfigError);
    expect(() => chooseModel({ GEMINI_API_KEY: '' })).toThrow(NO_KEY_MESSAGE);
    expect(NO_KEY_MESSAGE).toContain('https://aistudio.google.com/apikey');
    expect(NO_KEY_MESSAGE).toContain('GEMINI_API_KEY=');
    expect(NO_KEY_MESSAGE).toContain('--no-ai');
    expect(NO_KEY_MESSAGE.match(/^ {2}\d\. /gm)).toHaveLength(3);
  });

  it('--model picks the provider from the name and needs that provider’s key', () => {
    const env = { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' };
    expect(chooseModel(env, 'anthropic/claude-x')).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-x',
      stagehandModel: 'anthropic/claude-x',
      apiKey: 'a',
    });
    expect(chooseModel(env, 'gemini-9-flash')).toMatchObject({
      stagehandModel: 'google/gemini-9-flash',
      apiKey: 'g',
    });
    expect(chooseModel(env, 'claude-y')).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-y',
    });
    expect(() => chooseModel(env, 'openai/gpt-x')).toThrow(
      /needs a OpenAI key, but OPENAI_API_KEY is not set/,
    );
    expect(() => chooseModel(env, 'llama-3')).toThrow(/does not recognise the model/);
    expect(() => chooseModel(env, 'mistral/large')).toThrow(/does not recognise the model/);
  });

  it('never puts the key into an error message', () => {
    const secret = 'super-secret-key-value';
    try {
      chooseModel({ GEMINI_API_KEY: secret }, 'openai/gpt-x');
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });
});
