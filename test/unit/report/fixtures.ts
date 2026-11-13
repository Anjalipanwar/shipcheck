import type { ReportImage } from '../../../src/report/html.js';
import {
  makeFinding,
  type Finding,
  type FindingInput,
  type Report,
} from '../../../src/report/schema.js';
import { computeVerdict, countBySeverity, rankFindings } from '../../../src/report/verdict.js';

export const baseFinding: FindingInput = {
  rule: 'test/rule',
  title: 'Something is wrong',
  severity: 'minor',
  category: 'functional',
  device: 'desktop',
  whatHappened: 'It broke.',
  whyItMatters: 'People notice.',
  stepsToReproduce: ['Open the page.', 'Click the button.'],
  evidence: { screenshots: [], logs: ['a log line'] },
  confidence: 'verified',
};

export const finding = (overrides: Partial<FindingInput> = {}): Finding =>
  makeFinding({ ...baseFinding, ...overrides });

export function makeReport(findings: Finding[] = [], overrides: Partial<Report> = {}): Report {
  const ranked = rankFindings(findings);
  return {
    meta: {
      url: 'https://myapp.example.com/',
      startedAt: '2026-11-13T17:57:51.039Z',
      durationMs: 2075,
      model: null,
      shipcheckVersion: '0.1.0',
      mode: 'no-ai',
      partial: false,
      llmCalls: 0,
    },
    verdict: computeVerdict(ranked),
    counts: countBySeverity(ranked),
    findings: ranked,
    passed: ['Home page opens'],
    notTested: ['Signing up — needs an AI key'],
    actionLog: [],
    ...overrides,
  };
}

export const image = (file: string, bytes = 30, label = 'home page'): ReportImage => ({
  file,
  label,
  device: 'desktop',
  data: Buffer.alloc(bytes, 7),
});

/** A report that uses every part of the layout once. */
export function sampleReport(): { report: Report; images: ReportImage[] } {
  const images = [
    image('screenshots/01-desktop-home-page.jpg'),
    image('screenshots/02-desktop-login-failed.jpg', 30, 'login failed'),
  ];
  const report = makeReport(
    [
      finding({
        rule: 'seo/missing-description',
        title: 'Your home page has no description for search results',
        category: 'seo',
        device: 'both',
        evidence: { screenshots: [], logs: ['No <meta name="description"> found'] },
        fixPrompt: 'Add a <meta name="description"> tag.',
      }),
      finding({
        rule: 'secrets/stripe-secret-key',
        title: 'A secret key is visible to anyone who visits your app',
        severity: 'blocker',
        category: 'security',
        device: 'both',
        evidence: {
          screenshots: [],
          logs: ['Stripe secret key: sk_liv…eal1'],
          url: 'https://myapp.example.com/assets/app.js',
        },
        fixPrompt: 'Remove the key from client-side code.',
      }),
      finding({
        rule: 'login/no-error',
        title: 'Login shows no message when the password is wrong',
        severity: 'major',
        category: 'functional',
        flow: 'login',
        confidence: 'ai-judgement',
        evidence: {
          screenshots: ['screenshots/02-desktop-login-failed.jpg'],
          url: 'https://myapp.example.com/login',
        },
      }),
      finding({
        rule: 'https/local-address',
        title: 'Local address — HTTPS not checked',
        severity: 'info',
        category: 'security',
        stepsToReproduce: [],
        fixPrompt: '',
      }),
    ],
    { passed: ['Home page opens', 'Home page has a title'] },
  );
  return { report, images };
}
