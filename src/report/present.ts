import type { Finding, Report, Severity, Verdict } from './schema.js';

/**
 * Wording and grouping shared by every report format (HTML, Markdown, terminal),
 * so the three can never disagree about what a verdict or a section is called.
 */

export const VERDICT_LABEL: Record<Verdict, string> = {
  ready: 'Ready to launch',
  'fix-before-launch': 'Fix before launch',
  'not-ready': 'Not ready',
};

export const VERDICT_SUMMARY: Record<Verdict, string> = {
  ready: 'ShipCheck found nothing that should stop you from launching.',
  'fix-before-launch':
    'The app works, but some problems will confuse or lose real users. Fix the major issues before you launch.',
  'not-ready':
    'At least one problem would stop a new user or put your accounts at risk. Fix the blockers before you launch.',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
  info: 'Info',
};

export const SEVERITY_MEANING: Record<Severity, string> = {
  blocker: 'a new user cannot get through, or a secret is exposed',
  major: 'it works, but is broken or confusing for many users',
  minor: 'polish and edge cases',
  info: 'good to know, not a bug',
};

export const SEVERITIES: readonly Severity[] = ['blocker', 'major', 'minor', 'info'];

export const CATEGORY_LABEL: Record<Finding['category'], string> = {
  functional: 'Functionality',
  mobile: 'Mobile',
  forms: 'Forms',
  errors: 'Errors',
  security: 'Security',
  seo: 'SEO',
  accessibility: 'Accessibility',
  performance: 'Speed',
  coverage: 'Coverage',
};

export const DEVICE_LABEL: Record<Finding['device'], string> = {
  desktop: 'Desktop',
  mobile: 'Phone',
  both: 'Desktop and phone',
};

export const CONFIDENCE_LABEL: Record<Finding['confidence'], string> = {
  verified: 'Verified',
  'ai-judgement': 'AI judgement',
};

export const CONFIDENCE_LEGEND =
  '“Verified” means an automatic check measured it. “AI judgement” means the AI tester saw it while using the app — worth a quick look yourself.';

export const DISCLAIMER =
  'ShipCheck is an automated pre-launch check. It is not a security audit and not a guarantee that the app is free of bugs.';

export const NOT_CHECKED =
  'Not checked: active security testing, completing a payment, emails the app sends, business rules beyond what is visible on screen, behaviour under heavy traffic, and native mobile apps.';

/** Report sections for "All issues", in the order of SPEC §5.3 (plus three the spec did not name). */
const GROUPS = [
  ['landing', 'Landing page'],
  ['signup', 'Signup'],
  ['login', 'Login'],
  ['core', 'Main feature'],
  ['forms', 'Forms'],
  ['mobile', 'Mobile'],
  ['general', 'Across the app'],
  ['security', 'Security'],
  ['seo', 'Search and sharing (SEO)'],
  ['errors', 'Hidden errors'],
  ['accessibility', 'Accessibility'],
  ['performance', 'Speed'],
  ['other', 'Other notes'],
] as const;

export type GroupId = (typeof GROUPS)[number][0];

export interface FindingGroup {
  id: GroupId;
  label: string;
  findings: Finding[];
}

const TOPIC_GROUPS = new Set<string>(['security', 'seo', 'errors', 'accessibility', 'performance']);

/**
 * Which section a finding belongs to. A topic such as security wins over the flow it was found
 * in, so that all security findings sit together; otherwise the flow decides.
 */
export function groupOf(finding: Pick<Finding, 'category' | 'flow'>): GroupId {
  if (TOPIC_GROUPS.has(finding.category)) return finding.category as GroupId;
  if (finding.flow) return finding.flow;
  if (finding.category === 'mobile' || finding.category === 'forms') return finding.category;
  return finding.category === 'coverage' ? 'other' : 'general';
}

/** Non-empty groups in report order; findings keep the order they came in (most severe first). */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  return GROUPS.map(([id, label]) => ({
    id,
    label,
    findings: findings.filter((finding) => groupOf(finding) === id),
  })).filter((group) => group.findings.length > 0);
}

export function countsLine(counts: Report['counts']): string {
  return SEVERITIES.map((severity) => `${counts[severity]} ${severity}`).join(' · ');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "13 November 2026, 17:57 UTC" — always UTC, so a report reads the same wherever it is opened. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  const rest = seconds % 60;
  return rest === 0
    ? `${Math.floor(seconds / 60)} min`
    : `${Math.floor(seconds / 60)} min ${rest} s`;
}

export function modelLine(meta: Report['meta']): string {
  if (meta.mode === 'no-ai' || !meta.model) return 'None — automatic checks only';
  const limit = meta.llmCallLimit ? ` of ${meta.llmCallLimit} allowed` : '';
  return `${meta.model} (${meta.llmCalls} AI ${meta.llmCalls === 1 ? 'call' : 'calls'}${limit})`;
}

/**
 * Honest caveats shown right under the verdict. Without them, "Ready to launch" after a run that
 * never tried to sign up would promise more than ShipCheck actually checked.
 */
export function runCaveats(report: Report): string[] {
  const caveats: string[] = [];
  if (report.meta.mode === 'no-ai') {
    caveats.push(
      'This verdict is based on the automatic checks only. Signing up, logging in, the main feature and forms were not tested (on desktop or on a phone), because this run used no AI key. The phone layout was checked.',
    );
  }
  if (report.meta.partial) {
    caveats.push(
      'This run stopped early, so only part of the app was tested. See “What we couldn’t test” below.',
    );
  }
  return caveats;
}
