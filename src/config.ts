import { z } from 'zod';
import { isLocalAddress } from './browser/domain.js';

/** A problem with what the user typed. Shown as a friendly message, never a stack trace. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const FLOW_NAMES = ['landing', 'signup', 'login', 'core', 'forms'] as const;
export const FAIL_ON_LEVELS = ['blocker', 'major', 'none'] as const;

/**
 * Turns what the user typed into a full address.
 * "myapp.lovable.app" becomes "https://myapp.lovable.app"; local addresses default to http://.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ConfigError('Please give the address of the app to check.');

  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const host = trimmed.split(/[/:?#]/)[0] ?? '';
    candidate = `${isLocalAddress(host) ? 'http' : 'https'}://${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConfigError(
      `“${trimmed}” is not a valid web address. Example: https://myapp.lovable.app`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('The app address must start with http:// or https://');
  }
  if (!url.hostname.includes('.') && !isLocalAddress(url.hostname)) {
    throw new ConfigError(
      `“${trimmed}” is not a valid web address. Example: https://myapp.lovable.app`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError(
      'Please do not put a username or password inside the address. Use --email and --password (or the SHIPCHECK_EMAIL / SHIPCHECK_PASSWORD environment variables) instead.',
    );
  }
  url.hash = '';
  return url.toString();
}

const ConfigSchema = z.object({
  url: z.string(),
  out: z.string().min(1),
  noAi: z.boolean(),
  headed: z.boolean(),
  yes: z.boolean(),
  skipMobile: z.boolean(),
  maxMinutes: z.coerce
    .number({ error: '--max-minutes must be a number' })
    .int('--max-minutes must be a whole number')
    .min(1, '--max-minutes must be at least 1')
    .max(60, '--max-minutes can be at most 60'),
  failOn: z.enum(FAIL_ON_LEVELS),
  flows: z.array(z.enum(FLOW_NAMES)).min(1),
  model: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseFlows(value: unknown): unknown {
  if (value === undefined) return [...FLOW_NAMES];
  if (typeof value !== 'string') return value;
  const names = value
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const unknown = names.filter((name) => !(FLOW_NAMES as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new ConfigError(
      `Unknown flow “${unknown.join(', ')}”. Choose from: ${FLOW_NAMES.join(', ')}`,
    );
  }
  return [...new Set(names)];
}

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Merges command-line flags and environment variables into one validated Config. */
export function loadConfig(
  urlArg: string,
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Config {
  const url = normalizeUrl(urlArg);
  const email = optionalText(flags.email) ?? optionalText(env.SHIPCHECK_EMAIL);
  const password = optionalText(flags.password) ?? optionalText(env.SHIPCHECK_PASSWORD);
  const model = optionalText(flags.model);
  const goal = optionalText(flags.goal);

  const result = ConfigSchema.safeParse({
    url,
    out: flags.out ?? './shipcheck-report',
    // commander stores "--no-ai" as ai=false
    noAi: flags.ai === false || flags.noAi === true,
    headed: flags.headed === true,
    yes: flags.yes === true,
    skipMobile: flags.skipMobile === true,
    maxMinutes: flags.maxMinutes ?? 10,
    failOn: flags.failOn ?? 'blocker',
    flows: parseFlows(flags.flows),
    ...(model ? { model } : {}),
    ...(goal ? { goal } : {}),
    ...(email ? { email } : {}),
    ...(password ? { password } : {}),
  });
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}
