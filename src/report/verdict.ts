import {
  isUntested,
  type CoverageEntry,
  type Finding,
  type Report,
  type Severity,
  type Verdict,
} from './schema.js';

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };

export function countBySeverity(findings: readonly Finding[]): Report['counts'] {
  const counts = { blocker: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export interface VerdictContext {
  mode: Report['meta']['mode'];
  coverage: readonly CoverageEntry[];
}

/**
 * The verdict never promises more than the run tested (owner decision 2026-11-15):
 * - --no-ai: "checks-found-issues" if anything other than an Info note was found, otherwise
 *   "checks-passed" — never "ready", since nobody used the app like a visitor.
 * - Full run (SPEC §5.3): any Blocker → not ready; else any Major → fix before launch; else
 *   "partly-tested" if something blocked testing an area, otherwise "ready". Areas skipped by
 *   the user's choice, or that the app does not have, do not block "ready".
 * Exit codes do not depend on this; they follow the counts (see main.ts).
 */
export function computeVerdict(findings: readonly Finding[], context: VerdictContext): Verdict {
  const counts = countBySeverity(findings);
  if (context.mode === 'no-ai') {
    return counts.blocker + counts.major + counts.minor > 0
      ? 'checks-found-issues'
      : 'checks-passed';
  }
  if (counts.blocker > 0) return 'not-ready';
  if (counts.major > 0) return 'fix-before-launch';
  return context.coverage.some(isUntested) ? 'partly-tested' : 'ready';
}

/** "Fix these first" (SPEC §5.3): the most severe real problems. Info notes never qualify. */
export function topIssues(findings: readonly Finding[], limit = 3): Finding[] {
  return rankFindings(findings)
    .filter((finding) => finding.severity !== 'info')
    .slice(0, limit);
}

/** Most severe first; ties keep their original order so reports are stable between runs. */
export function rankFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
        a.index - b.index,
    )
    .map(({ finding }) => finding);
}
