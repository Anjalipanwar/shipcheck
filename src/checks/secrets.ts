import { makeFinding, type Finding } from '../report/schema.js';
import type { CheckResult } from './types.js';

export interface SecretSource {
  /** Where the text came from (page or script address). */
  url: string;
  content: string;
}

export interface SecretMatch {
  /** Machine name, e.g. "stripe-secret-key". */
  type: string;
  /** Plain-English name for the report. */
  label: string;
  /** Masked value — the raw secret is never kept. */
  masked: string;
  url: string;
}

interface Pattern {
  type: string;
  label: string;
  regex: RegExp;
}

/** Characters that can be part of a key; used to make sure a match is not cut out of a longer word. */
const BEFORE = '(?<![A-Za-z0-9_-])';
const AFTER = '(?![A-Za-z0-9_-])';

/**
 * SECRET keys only (SPEC §6.2). Public-by-design keys — Stripe pk_, Supabase anon/publishable,
 * Firebase web config (AIza…), Google Maps browser keys — are deliberately not listed.
 */
const PATTERNS: Pattern[] = [
  {
    type: 'stripe-secret-key',
    label: 'Stripe secret key',
    regex: new RegExp(`${BEFORE}(?:sk|rk)_live_[0-9a-zA-Z]{24,}${AFTER}`, 'g'),
  },
  {
    type: 'anthropic-api-key',
    label: 'Anthropic (Claude) API key',
    regex: new RegExp(`${BEFORE}sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{32,}${AFTER}`, 'g'),
  },
  {
    type: 'openai-api-key',
    label: 'OpenAI API key',
    regex: new RegExp(
      `${BEFORE}sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}|[A-Za-z0-9]{48})${AFTER}`,
      'g',
    ),
  },
  {
    type: 'aws-access-key',
    label: 'Amazon Web Services (AWS) access key',
    regex: new RegExp(`${BEFORE}(?:AKIA|ASIA)[0-9A-Z]{16}${AFTER}`, 'g'),
  },
  {
    type: 'github-token',
    label: 'GitHub access token',
    regex: new RegExp(
      `${BEFORE}(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})${AFTER}`,
      'g',
    ),
  },
  {
    type: 'supabase-secret-key',
    label: 'Supabase secret key',
    regex: new RegExp(`${BEFORE}sb_secret_[A-Za-z0-9_-]{20,}${AFTER}`, 'g'),
  },
  {
    type: 'private-key',
    label: 'private encryption key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
];

const JWT = new RegExp(
  `${BEFORE}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}${AFTER}`,
  'g',
);
const SUPABASE_PUBLISHABLE = new RegExp(`${BEFORE}sb_publishable_[A-Za-z0-9_-]{20,}${AFTER}`);

/** Shows the first 6 and last 4 characters only (SPEC §6.2). */
export function maskSecret(value: string): string {
  if (value.startsWith('-----BEGIN')) return `${value.slice(0, 6)}…(private key)`;
  if (value.length <= 12) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Reads the middle part of a JWT. Returns null if it is not a readable JWT. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Documentation examples and obvious placeholders, e.g. AWS's AKIAIOSFODNN7EXAMPLE. */
function isPlaceholder(value: string): boolean {
  const body = value.replace(/^[a-z]{2,10}[_-](?:live_|ant-|proj-)?/i, '');
  return (
    /EXAMPLE$/i.test(value) ||
    /x{8,}|0{12,}|\*{4,}|\.{3,}/i.test(body) ||
    /^(.)\1+$/.test(body) ||
    /your[_-]?(api[_-]?)?key|placeholder|replace[_-]?me|changeme/i.test(value)
  );
}

export interface SecretScan {
  secrets: SecretMatch[];
  /** A public Supabase key was seen (fine by design, but worth a reminder). */
  supabasePublicKeySeenAt: string | undefined;
}

/** Scans texts for secret keys. Each distinct secret is reported once. */
export function findSecrets(sources: readonly SecretSource[]): SecretScan {
  const secrets = new Map<string, SecretMatch>();
  let supabasePublicKeySeenAt: string | undefined;

  for (const { url, content } of sources) {
    for (const pattern of PATTERNS) {
      for (const match of content.matchAll(pattern.regex)) {
        const value = match[0];
        if (isPlaceholder(value)) continue;
        if (pattern.type === 'openai-api-key' && !/\d/.test(value)) continue;
        const key = `${pattern.type}:${value}`;
        if (!secrets.has(key)) {
          secrets.set(key, {
            type: pattern.type,
            label: pattern.label,
            masked: maskSecret(value),
            url,
          });
        }
      }
    }

    for (const match of content.matchAll(JWT)) {
      const payload = decodeJwtPayload(match[0]);
      if (!payload) continue;
      if (payload.role === 'service_role') {
        const key = `supabase-service-role:${match[0]}`;
        if (!secrets.has(key)) {
          secrets.set(key, {
            type: 'supabase-service-role',
            label: 'Supabase “service_role” key (full database access)',
            masked: maskSecret(match[0]),
            url,
          });
        }
      } else if (payload.role === 'anon' && supabasePublicKeySeenAt === undefined) {
        supabasePublicKeySeenAt = url;
      }
    }
    if (supabasePublicKeySeenAt === undefined && SUPABASE_PUBLISHABLE.test(content)) {
      supabasePublicKeySeenAt = url;
    }
  }

  return { secrets: [...secrets.values()], supabasePublicKeySeenAt };
}

/** SPEC §6.2: exposed secret = Blocker; Supabase public key = Info reminder about RLS. */
export function checkSecrets(sources: readonly SecretSource[]): CheckResult {
  const scan = findSecrets(sources);
  const findings: Finding[] = [];

  for (const secret of scan.secrets) {
    findings.push(
      makeFinding({
        rule: `secrets/${secret.type}`,
        title: `A secret key is visible to anyone who visits your app (${secret.label})`,
        severity: 'blocker',
        category: 'security',
        device: 'both',
        whatHappened: `A ${secret.label} is included in the files your app sends to every visitor’s browser. Anyone can read it by viewing the page’s source. Key found: ${secret.masked} (shortened here on purpose).`,
        whyItMatters:
          'A secret key works like a password to your account with that service. Someone who copies it can run up charges, read private data or delete things in your name.',
        stepsToReproduce: [
          `Open ${secret.url} in your browser.`,
          `Search the text (Ctrl/Cmd + F) for “${secret.masked.split('…')[0]}”.`,
        ],
        evidence: {
          screenshots: [],
          logs: [`${secret.label}: ${secret.masked}`, `Found in: ${secret.url}`],
          url: secret.url,
        },
        fixPrompt: `A ${secret.label} (starting with "${secret.masked.split('…')[0]}") is exposed in my frontend code. Please: 1) remove it from all client-side code, 2) move every call that needs it to a server-side function or API route that reads the key from an environment variable, 3) tell me to revoke this key and create a new one in the provider's dashboard, because the old one must be treated as leaked.`,
        confidence: 'verified',
      }),
    );
  }

  if (scan.supabasePublicKeySeenAt !== undefined) {
    findings.push(
      makeFinding({
        rule: 'secrets/supabase-public-key-reminder',
        title: 'Your app uses a public Supabase key — make sure Row Level Security is enabled',
        severity: 'info',
        category: 'security',
        device: 'both',
        whatHappened:
          'Your app contains a public Supabase key. That is normal and safe by design — it is meant to be visible.',
        whyItMatters:
          'The public key is only safe if “Row Level Security” is switched on for every table in Supabase. Without it, anyone can read or change all your data. ShipCheck cannot see your database settings, so please check this yourself.',
        stepsToReproduce: [],
        evidence: {
          screenshots: [],
          logs: [`Public Supabase key found in: ${scan.supabasePublicKeySeenAt}`],
          url: scan.supabasePublicKeySeenAt,
        },
        fixPrompt:
          'Please check that Row Level Security (RLS) is enabled on every table in my Supabase project and that each table has policies so users can only read and change their own rows. List any table without RLS.',
        confidence: 'verified',
      }),
    );
  }

  return {
    findings,
    passed:
      scan.secrets.length === 0
        ? [`No secret keys found in the ${sources.length} page and script files we scanned`]
        : [],
    notTested: [],
  };
}
