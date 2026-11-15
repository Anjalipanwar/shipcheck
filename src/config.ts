import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Optional settings file in the folder ShipCheck is started from (SPEC §5.1). */
export const CONFIG_FILE = 'shipcheck.config.json';

/**
 * What the settings file may hold: the same things as the flags, under the flags' names in
 * camelCase. Not the password and not "yes" — see `readConfigFile`.
 */
const FileSchema = z.strictObject({
  email: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  out: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  skipMobile: z.boolean().optional(),
  flows: z.union([z.string(), z.array(z.string())]).optional(),
  maxMinutes: z.number().optional(),
  failOn: z.enum(FAIL_ON_LEVELS).optional(),
  noAi: z.boolean().optional(),
  headed: z.boolean().optional(),
});
export type FileSettings = z.infer<typeof FileSchema>;
const FILE_KEYS = Object.keys(FileSchema.shape);

/**
 * Reads `shipcheck.config.json` from `dir`; no file means no settings. Two settings are refused
 * on purpose, because such a file is easily committed to a public repository:
 *  - "password": a secret does not belong in a file (SPEC §7.6) — use SHIPCHECK_PASSWORD;
 *  - "yes": confirming that you may test an app is said each time, not stored (SPEC §7.7).
 */
export function readConfigFile(dir: string): FileSettings {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ConfigError(
      `${CONFIG_FILE} could not be read: it is not valid JSON. Check it for a missing comma, quote or bracket.`,
    );
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`${CONFIG_FILE} must contain settings in curly brackets: { … }`);
  }
  if ('password' in raw) {
    throw new ConfigError(
      `Please remove “password” from ${CONFIG_FILE}: a password must not be kept in a file. Set the SHIPCHECK_PASSWORD environment variable instead (in GitHub: a repository secret).`,
    );
  }
  if ('yes' in raw) {
    throw new ConfigError(
      `Please remove “yes” from ${CONFIG_FILE}. Confirming that you may test the app cannot be stored in a file: answer the question when ShipCheck asks, or add --yes to the command.`,
    );
  }
  const unknown = Object.keys(raw).filter((key) => !FILE_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new ConfigError(
      `${CONFIG_FILE} has a setting ShipCheck does not know: “${unknown.join('”, “')}”. Known settings: ${FILE_KEYS.join(', ')}`,
    );
  }
  const result = FileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `${CONFIG_FILE}: ${result.error.issues
        .map((issue) => `“${issue.path.join('.')}” has the wrong kind of value (${issue.message})`)
        .join('; ')}`,
    );
  }
  return result.data;
}

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

/**
 * Merges command-line flags, environment variables and the settings file into one validated
 * Config. A flag wins over the environment, the environment over the file, the file over the
 * built-in defaults.
 */
export function loadConfig(
  urlArg: string,
  flags: Record<string, unknown>,
  env: Record<string, string | undefined>,
  file: FileSettings = {},
): Config {
  const url = normalizeUrl(urlArg);
  const email = optionalText(flags.email) ?? optionalText(env.SHIPCHECK_EMAIL) ?? file.email;
  const password = optionalText(flags.password) ?? optionalText(env.SHIPCHECK_PASSWORD);
  const model = optionalText(flags.model) ?? file.model;
  const goal = optionalText(flags.goal) ?? file.goal;
  const fileFlows = Array.isArray(file.flows) ? file.flows.join(',') : file.flows;

  const result = ConfigSchema.safeParse({
    url,
    out: flags.out ?? file.out ?? './shipcheck-report',
    // commander stores "--no-ai" as ai=false
    noAi: flags.ai === false || flags.noAi === true || file.noAi === true,
    headed: flags.headed === true || file.headed === true,
    yes: flags.yes === true,
    skipMobile: flags.skipMobile === true || file.skipMobile === true,
    maxMinutes: flags.maxMinutes ?? file.maxMinutes ?? 10,
    failOn: flags.failOn ?? file.failOn ?? 'blocker',
    flows: parseFlows(flags.flows ?? fileFlows),
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
