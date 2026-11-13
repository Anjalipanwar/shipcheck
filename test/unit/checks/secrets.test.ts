import { describe, expect, it } from 'vitest';
import {
  checkSecrets,
  decodeJwtPayload,
  findSecrets,
  maskSecret,
} from '../../../src/checks/secrets.js';

/**
 * Fake keys are assembled from parts so that no secret-looking string is ever committed.
 * None of these are real credentials.
 */
const join = (...parts: string[]) => parts.join('');
const A24 = 'FAKEshipcheckUNIT00000001';
const jwt = (payload: object) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'c2lnbmF0dXJlLW5vdC1yZWFsLTEyMzQ1Njc4OTA',
  ].join('.');

const FAKES = {
  stripeSecret: join('sk', '_live_', A24),
  stripeRestricted: join('rk', '_live_', A24),
  anthropic: join('sk', '-ant-', 'api03-', 'FAKEfake0123456789FAKEfake0123456789abcd'),
  openaiProject: join('sk', '-proj-', 'FAKEfake0123456789FAKEfake0123456789abcdEFGH'),
  openaiLegacy: join('sk', '-', 'FAKEfake0123456789ab', 'T3BlbkFJ', 'FAKEfake0123456789ab'),
  aws: join('AKIA', 'FAKE0UNIT1TEST2KEY3'.slice(0, 16)),
  github: join('ghp', '_', 'FAKEfake0123456789FAKEfake0123456789'),
  githubPat: join('github', '_pat_', 'FAKEfake0123456789_'.repeat(4)),
  supabaseSecret: join('sb', '_secret_', 'FAKEfake0123456789abcd'),
  privateKey: join('-----BEGIN ', 'RSA PRIVATE KEY', '-----'),
  serviceRoleJwt: jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role' }),
  anonJwt: jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' }),
};

const scan = (content: string) => findSecrets([{ url: 'https://example.test/app.js', content }]);
const types = (content: string) => scan(content).secrets.map((s) => s.type);

describe('findSecrets: true positives', () => {
  it.each([
    ['Stripe secret key', FAKES.stripeSecret, 'stripe-secret-key'],
    ['Stripe restricted key', FAKES.stripeRestricted, 'stripe-secret-key'],
    ['Anthropic key', FAKES.anthropic, 'anthropic-api-key'],
    ['OpenAI project key', FAKES.openaiProject, 'openai-api-key'],
    ['OpenAI legacy key', FAKES.openaiLegacy, 'openai-api-key'],
    ['AWS access key', FAKES.aws, 'aws-access-key'],
    ['GitHub token', FAKES.github, 'github-token'],
    ['GitHub fine-grained token', FAKES.githubPat, 'github-token'],
    ['Supabase secret key', FAKES.supabaseSecret, 'supabase-secret-key'],
    ['private key', FAKES.privateKey, 'private-key'],
    ['Supabase service_role JWT', FAKES.serviceRoleJwt, 'supabase-service-role'],
  ])('finds a %s', (_name, value, type) => {
    expect(types(`const config = { key: "${value}" };`)).toEqual([type]);
  });

  it('finds keys inside minified code and template strings', () => {
    expect(types(`a=1;b=\`Bearer ${FAKES.stripeSecret}\`;c=2`)).toEqual(['stripe-secret-key']);
    expect(types(`fetch(u,{headers:{Authorization:'Bearer '+'${FAKES.openaiProject}'}})`)).toEqual([
      'openai-api-key',
    ]);
  });

  it('reports the same secret once, even across files', () => {
    const result = findSecrets([
      { url: 'https://example.test/a.js', content: `${FAKES.stripeSecret} ${FAKES.stripeSecret}` },
      { url: 'https://example.test/b.js', content: FAKES.stripeSecret },
    ]);
    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0]?.url).toBe('https://example.test/a.js');
  });

  it('never keeps the raw secret', () => {
    const result = scan(`${FAKES.stripeSecret} ${FAKES.serviceRoleJwt} ${FAKES.anthropic}`);
    const dump = JSON.stringify(result);
    for (const raw of [FAKES.stripeSecret, FAKES.serviceRoleJwt, FAKES.anthropic]) {
      expect(dump).not.toContain(raw);
    }
  });
});

describe('findSecrets: false positives (must NOT be flagged)', () => {
  it.each([
    ['Stripe publishable live key', join('pk', '_live_', A24)],
    ['Stripe publishable test key', join('pk', '_test_', A24)],
    ['Stripe TEST secret key (not in SPEC list)', join('sk', '_test_', A24)],
    ['Firebase web API key', join('AIza', 'SyFAKEfake0123456789FAKEfake0123456')],
    [
      'Google Maps browser key',
      `https://maps.googleapis.com/maps/api/js?key=${join('AIza', 'SyFAKEfake0123456789FAKEfake0123456')}`,
    ],
    ['Supabase anon JWT', FAKES.anonJwt],
    ['Supabase publishable key', join('sb', '_publishable_', 'FAKEfake0123456789abcd')],
    ['an ordinary login JWT', jwt({ sub: 'user-1', role: 'authenticated', exp: 1999999999 })],
    ['AWS documentation example', 'AKIAIOSFODNN7EXAMPLE'],
    ['placeholder', join('sk', '_live_', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx')],
    ['placeholder words', 'sk-your-api-key-here'],
    ['too short to be a key', join('sk', '_live_', 'abc123')],
    [
      'CSS class names',
      '.task-list{} .risk-score-high{} .mask-image-linear-gradient-to-right-from-transparent{}',
    ],
    [
      'word ending in sk-',
      'const x = "desk-lamp-with-a-very-long-product-name-0123456789-abcdefghij";',
    ],
    ['key cut out of a longer word', `prefix${join('sk', '_live_', A24)}`],
    ['48 letters without a digit', `sk-${'abcdefghijklmnopqrstuvwxABCDEFGHIJKLMNOPQRSTUVWX'}`],
    ['public key block', '-----BEGIN PUBLIC KEY-----'],
    ['certificate', '-----BEGIN CERTIFICATE-----'],
    ['git commit hash', 'ghp is a prefix; commit 3f786850e387550fdab836ed7e6dc881de23001b'],
    ['empty text', ''],
  ])('ignores %s', (_name, content) => {
    expect(types(content)).toEqual([]);
  });

  it('notes a public Supabase key without treating it as a secret', () => {
    expect(scan(FAKES.anonJwt)).toEqual({
      secrets: [],
      supabasePublicKeySeenAt: 'https://example.test/app.js',
    });
    expect(
      scan(join('sb', '_publishable_', 'FAKEfake0123456789abcd')).supabasePublicKeySeenAt,
    ).toBeDefined();
    expect(scan('nothing here').supabasePublicKeySeenAt).toBeUndefined();
  });
});

describe('decodeJwtPayload', () => {
  it('reads the role out of a JWT', () => {
    expect(decodeJwtPayload(FAKES.serviceRoleJwt)).toMatchObject({ role: 'service_role' });
    expect(decodeJwtPayload(FAKES.anonJwt)).toMatchObject({ role: 'anon' });
  });
  it.each([
    '',
    'abc',
    'a.b.c',
    'eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.sig',
    `x.${Buffer.from('[1,2]').toString('base64url')}.y`,
  ])('returns null for %j', (token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('maskSecret', () => {
  it('shows only the first 6 and last 4 characters', () => {
    expect(maskSecret('abcdefghijklmnopqrstuvwxyz')).toBe('abcdef…wxyz');
  });
  it('shows almost nothing of short values and private keys', () => {
    expect(maskSecret('short')).toBe('sh…');
    expect(maskSecret(FAKES.privateKey)).not.toContain('RSA');
  });
});

describe('checkSecrets', () => {
  it('reports an exposed secret as a Blocker with masked evidence', () => {
    const result = checkSecrets([
      { url: 'https://example.test/app.js', content: FAKES.stripeSecret },
    ]);
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding).toMatchObject({
      severity: 'blocker',
      category: 'security',
      rule: 'secrets/stripe-secret-key',
      confidence: 'verified',
    });
    expect(finding?.evidence.logs?.join(' ')).toContain('sk_liv…');
    expect(JSON.stringify(result)).not.toContain(FAKES.stripeSecret);
    expect(result.passed).toEqual([]);
  });

  it('adds an Info reminder about Row Level Security for a public Supabase key', () => {
    const result = checkSecrets([{ url: 'https://example.test/app.js', content: FAKES.anonJwt }]);
    expect(result.findings.map((f) => [f.severity, f.rule])).toEqual([
      ['info', 'secrets/supabase-public-key-reminder'],
    ]);
    expect(result.findings[0]?.title).toMatch(/Row Level Security/);
    expect(result.passed).toHaveLength(1);
  });

  it('passes clean files', () => {
    const result = checkSecrets([
      { url: 'https://example.test/app.js', content: 'console.log("hello")' },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.passed[0]).toMatch(/No secret keys found/);
  });
});
