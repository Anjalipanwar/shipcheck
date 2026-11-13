import { makeFinding } from '../report/schema.js';
import type { CheckResult } from './types.js';

export interface HeaderFacts {
  url: string;
  /** Response headers of the page, with lower-case names. */
  headers: Record<string, string>;
}

interface HeaderRule {
  name: string;
  plain: string;
  present(headers: Record<string, string>, isHttps: boolean): boolean | 'not-applicable';
}

const has = (headers: Record<string, string>, name: string): boolean =>
  (headers[name] ?? '').trim().length > 0;

const RULES: HeaderRule[] = [
  {
    name: 'Content-Security-Policy',
    plain: 'limits which scripts may run on your pages',
    present: (h) => has(h, 'content-security-policy'),
  },
  {
    name: 'Strict-Transport-Security',
    plain: 'tells browsers to always use the secure connection',
    present: (h, isHttps) => (isHttps ? has(h, 'strict-transport-security') : 'not-applicable'),
  },
  {
    name: 'X-Content-Type-Options',
    plain: 'stops browsers from guessing file types',
    present: (h) => (h['x-content-type-options'] ?? '').toLowerCase().includes('nosniff'),
  },
  {
    name: 'X-Frame-Options (or CSP frame-ancestors)',
    plain: 'stops other sites from showing your app inside a hidden frame',
    present: (h) =>
      has(h, 'x-frame-options') || /frame-ancestors/i.test(h['content-security-policy'] ?? ''),
  },
  {
    name: 'Referrer-Policy',
    plain: 'controls how much of your page address is shared with other sites',
    present: (h) => has(h, 'referrer-policy'),
  },
];

/** SPEC §6.2: missing security headers → one Minor finding listing them all. */
export function checkHeaders(facts: HeaderFacts): CheckResult {
  const headers = Object.fromEntries(
    Object.entries(facts.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const isHttps = facts.url.startsWith('https://');
  const missing = RULES.filter((rule) => rule.present(headers, isHttps) === false);
  const applicable = RULES.filter((rule) => rule.present(headers, isHttps) !== 'not-applicable');

  if (missing.length === 0) {
    return {
      findings: [],
      passed: [`All ${applicable.length} recommended security settings are switched on`],
      notTested: [],
    };
  }

  return {
    findings: [
      makeFinding({
        rule: 'headers/missing-security-headers',
        title: `${missing.length} recommended security ${missing.length === 1 ? 'setting is' : 'settings are'} switched off`,
        severity: 'minor',
        category: 'security',
        device: 'both',
        whatHappened: `Your server does not send ${missing.length === 1 ? 'a standard protective instruction' : `${missing.length} standard protective instructions`} (“security headers”) to browsers: ${missing
          .map((rule) => `${rule.name} (${rule.plain})`)
          .join('; ')}.`,
        whyItMatters:
          'They are an extra layer of protection that makes common attacks harder. Nothing is broken today, but they are quick to add.',
        stepsToReproduce: [
          `Open ${facts.url}.`,
          'Open the developer tools → Network tab, reload, click the first request and look at “Response Headers”.',
        ],
        evidence: {
          screenshots: [],
          logs: missing.map((rule) => `Missing: ${rule.name}`),
          url: facts.url,
        },
        fixPrompt: `Please add these HTTP security headers to every response of my app (via the hosting platform's config file or the server middleware):\n${missing
          .map((rule) => `- ${rule.name}`)
          .join(
            '\n',
          )}\nUse safe defaults: "X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin", "X-Frame-Options: DENY" (or CSP frame-ancestors 'none'), "Strict-Transport-Security: max-age=31536000; includeSubDomains", and a Content-Security-Policy that allows only the sources the app really uses. Make sure the app still works afterwards.`,
        confidence: 'verified',
      }),
    ],
    passed:
      applicable.length > missing.length
        ? [
            `${applicable.length - missing.length} of ${applicable.length} recommended security settings are switched on`,
          ]
        : [],
    notTested: [],
  };
}
