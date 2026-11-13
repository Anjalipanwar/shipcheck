import type { Finding, Report, Severity, Verdict } from './schema.js';

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };

export function countBySeverity(findings: readonly Finding[]): Report['counts'] {
  const counts = { blocker: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** SPEC §5.3: any Blocker → not ready; else any Major → fix before launch; else ready. */
export function computeVerdict(findings: readonly Finding[]): Verdict {
  const counts = countBySeverity(findings);
  if (counts.blocker > 0) return 'not-ready';
  if (counts.major > 0) return 'fix-before-launch';
  return 'ready';
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
