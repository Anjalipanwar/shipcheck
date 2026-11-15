import { REPO_URL } from '../version.js';
import type {
  CoverageArea,
  CoverageEntry,
  CoverageState,
  Finding,
  Report,
  Severity,
  Verdict,
} from './schema.js';

/**
 * Wording and grouping shared by every report format (HTML, Markdown, terminal),
 * so the three can never disagree about what a verdict or a section is called.
 */

export const VERDICT_LABEL: Record<Verdict, string> = {
  ready: 'Ready to launch',
  'fix-before-launch': 'Fix before launch',
  'not-ready': 'Not ready',
  'partly-tested': 'Partly tested — no serious problems found so far',
  'checks-passed': 'Automatic checks passed — app not tested as a user',
  'checks-found-issues': 'Automatic checks found issues',
};

const NOT_USED_AS_VISITOR = 'ShipCheck did not use your app like a visitor';

/** The sentence under the verdict. Neutral verdicts still say plainly when a Blocker was found. */
export function verdictSummary(report: Pick<Report, 'verdict' | 'counts' | 'findings'>): string {
  const paid = report.findings.some((finding) => finding.rule === REACHED_PAYMENT_RULE);
  return paid ? `${verdictText(report)} ${NEVER_PAYS}` : verdictText(report);
}

/** Added to the verdict text whenever a flow reached a payment step and stopped there. */
export const NEVER_PAYS =
  'ShipCheck never pays. Test your payment yourself with a test card before you launch.';
export const REACHED_PAYMENT_RULE = 'coverage/reached-payment';

function verdictText(report: Pick<Report, 'verdict' | 'counts'>): string {
  switch (report.verdict) {
    case 'ready':
      return 'ShipCheck found nothing that should stop you from launching.';
    case 'fix-before-launch':
      return 'The app works, but some problems will confuse or lose real users. Fix the major issues before you launch.';
    case 'not-ready':
      return 'At least one problem would stop a new user or is a security risk. Fix the blockers before you launch.';
    case 'partly-tested':
      return 'ShipCheck found no blockers or major problems in the parts it could test, but some areas were not tested (marked ○ or “Only partly tested” below). Check those yourself before you launch.';
    case 'checks-passed':
      return `The automatic checks found nothing to fix. ${NOT_USED_AS_VISITOR}, so this is not a launch verdict.`;
    case 'checks-found-issues': {
      const lead =
        report.counts.blocker > 0
          ? 'At least one is a blocker: fix it before you launch. '
          : report.counts.major > 0
            ? 'At least one is major: fix it before you launch. '
            : '';
      return `${lead}${NOT_USED_AS_VISITOR}, so a full check may find more.`;
    }
  }
}

/** Banner colour: neutral verdicts take the colour of the worst finding, never green. */
export type VerdictTone = 'ok' | 'blocker' | 'major' | 'neutral';
export function verdictTone(report: Pick<Report, 'verdict' | 'counts'>): VerdictTone {
  if (report.verdict === 'ready') return 'ok';
  if (report.verdict === 'not-ready') return 'blocker';
  if (report.verdict === 'fix-before-launch') return 'major';
  if (report.counts.blocker > 0) return 'blocker';
  if (report.counts.major > 0) return 'major';
  return 'neutral';
}

/** "Fix these first" when there is nothing to fix: it may only promise what the verdict does. */
export function nothingUrgentText(report: Pick<Report, 'verdict'>): string {
  switch (report.verdict) {
    case 'checks-passed':
    case 'checks-found-issues':
      return 'Nothing urgent. The automatic checks found nothing that needs fixing first.';
    case 'partly-tested':
      return 'Nothing urgent in the parts ShipCheck could test.';
    default:
      return 'Nothing urgent. ShipCheck found no problems that need fixing before launch.';
  }
}

/* ---- “What this report covers” (owner decisions 2026-11-15) -------------------------- */

export const COVERAGE_TITLE = 'What this report covers';

export const AREA_LABEL: Record<CoverageArea, string> = {
  signup: 'Sign-up',
  login: 'Log-in',
  core: 'Main feature',
  forms: 'Forms (including wrong or missing input)',
  'phone-flows': 'Using it on a phone',
  'phone-layout': 'Phone screen layout',
  errors: 'Hidden errors',
  links: 'Broken links',
  seo: 'SEO',
  security: 'Basic security',
  accessibility: 'Accessibility',
};

export const GROUP_LABEL = {
  visitor: 'Using your app like a visitor (full check only)',
  automatic: 'Automatic checks (always run)',
} as const;

export const CHECK_TYPE_LABEL: Record<Report['meta']['mode'], string> = {
  full: 'Full check (AI)',
  'no-ai': 'Automatic checks only (no AI)',
};

/** "Tried to": the rows below say how far it got, so this never claims a step that did not happen. */
export const COVERAGE_DID: Record<Report['meta']['mode'], string> = {
  full: 'ShipCheck tried to use your app like a new visitor: signing up, logging in, using the main feature and filling in forms, on desktop and on a phone. It also ran the automatic checks. The list shows how far it got.',
  'no-ai':
    'ShipCheck loaded your pages and checked them from the outside: hidden errors, broken links, phone screen layout, SEO and basic security. It did not sign up, log in or use any feature.',
};

/** Shown in automatic-only reports. */
export const COVERAGE_WHY_DIFFER =
  'Automatic checks can’t find problems that only appear when someone uses the app, such as a sign-up that fails or a button that does nothing. That’s why a full check often finds more than automatic checks.';

export const COVERAGE_TABLE_CAPTION = 'What happened in each area';

export const COVERAGE_NEXT_LABEL: Record<Report['meta']['mode'], string> = {
  full: 'Please note:',
  'no-ai': 'Next step:',
};

export const COVERAGE_NEXT_FULL =
  'This is not a guarantee that your app is free of bugs. Anything ShipCheck could not test is listed under “What we couldn’t test”.';

export const COVERAGE_NEXT_NO_AI =
  'Run the full check to test your app like a real visitor. You need a free AI key.';

export const AI_KEY_HELP = {
  text: 'How to get a free AI key',
  url: `${REPO_URL}#get-a-free-ai-key`,
};

/** The command for the full check. The address is quoted when a shell could misread it (&, ?, #…). */
export function fullCheckCommand(url: string): string {
  const safe = /^[A-Za-z0-9:/._~%-]+$/.test(url);
  return `npx @anjalipanwar/shipcheck ${safe ? url : `"${url.replace(/(["\\$`])/g, '\\$1')}"`}`;
}

/** The reason a visitor area shows in an automatic-only report. */
export const NEEDS_FULL_CHECK = 'this needs the full check';

/** What the user can do about a "not tested" area. Every such reason ends with one of these. */
export const ADVICE = {
  quota: 'Try again tomorrow, or use a paid key',
  calls:
    'This check was too big for one run. Check fewer parts at a time: run ShipCheck again with --flows core',
  time: 'Run ShipCheck again with a higher --max-minutes',
  account: 'Add a test account (see the README)',
  goal: 'Describe the main task with --goal "…"',
  goalOrHand: 'Check it by hand, or describe the task with --goal "…"',
  byHand: 'Check this part by hand',
  retry: 'Try again; if it keeps happening, please report it',
  payment: 'Test the payment step yourself, in your payment provider’s test mode',
  fixHome: 'Fix that first, then run ShipCheck again',
  key: 'Check your AI key and try again',
} as const;

export const STATE_ICON: Record<CoverageState, string> = {
  'no-problems': '✓',
  problems: '⚠',
  'not-tested': '○',
  skipped: '—',
  absent: '—',
  'payment-stop': '—',
};

/** The words next to the icon. Reasons and next steps are added by `stateNote`. */
export function stateText(entry: CoverageEntry): string {
  switch (entry.state) {
    case 'no-problems':
      return 'No problems found';
    case 'problems':
      return `${entry.problems ?? 1} ${entry.problems === 1 || !entry.problems ? 'problem' : 'problems'}`;
    case 'not-tested':
      return entry.note ? `Not tested: ${entry.note}` : 'Not tested';
    case 'skipped':
      return entry.note ? `Skipped by your choice: ${entry.note}` : 'Skipped by your choice';
    case 'absent':
      return entry.note ? `Not in your app: ${entry.note}` : 'Not in your app';
    case 'payment-stop':
      return 'Stopped before payment (by design)';
  }
}

/** Extra line for an area with problems that could also only partly be tested. */
export function partialNote(entry: CoverageEntry): string | undefined {
  return entry.state === 'problems' && entry.partial
    ? `Only partly tested${entry.note ? `: ${entry.note}` : ''}`
    : undefined;
}

/** Problems that belong to no row (page speed, a dead button on the home page…). */
export function otherProblemsText(count: number): string {
  return `${count} more ${count === 1 ? 'problem is' : 'problems are'} not part of one of these areas (for example page speed or the home page itself). See “All issues”.`;
}

/** The terminal's one-line version of the box. */
export function coverageLine(report: Pick<Report, 'meta' | 'coverage'>): string {
  const names = (state: CoverageState[]) =>
    report.coverage.filter((e) => state.includes(e.state)).map((e) => AREA_LABEL[e.area]);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const fine = names(['no-problems']).length;
  const problems = names(['problems']);
  const untested = names(['not-tested']);
  const skipped = names(['skipped']);
  const absent = names(['absent']);
  const payment = names(['payment-stop']);
  const parts = [
    `${count(fine, 'area', 'areas')} without problems`,
    ...(problems.length > 0 ? [`problems in: ${problems.join(', ')}`] : []),
    ...(untested.length > 0 ? [`not tested: ${untested.join(', ')}`] : []),
    ...(skipped.length > 0 ? [`skipped by your choice: ${skipped.join(', ')}`] : []),
    ...(absent.length > 0 ? [`not in your app: ${absent.join(', ')}`] : []),
    ...(payment.length > 0 ? [`stopped before payment (by design): ${payment.join(', ')}`] : []),
  ];
  return `${COVERAGE_TITLE}: ${CHECK_TYPE_LABEL[report.meta.mode]} — ${parts.join('; ')}.`;
}

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

/** "1 Blocker", "2 Blockers"; Major, Minor and Info are describing words and stay as they are. */
export function severityCount(severity: Severity, count: number): string {
  const label = SEVERITY_LABEL[severity];
  return `${count} ${severity === 'blocker' && count !== 1 ? `${label}s` : label}`;
}

export function countsLine(counts: Report['counts']): string {
  return SEVERITIES.map((severity) => severityCount(severity, counts[severity])).join(' · ');
}

/** One line under the counts, in every format. */
export const SEVERITY_LEGEND =
  'Blocker = stops people using your app · Major = breaks or confuses many people · Minor = polish';

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
