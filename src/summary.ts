import { SEVERITY_LEGEND, VERDICT_LABEL, countsLine, coverageLine } from './report/present.js';
import type { Report } from './report/schema.js';
import { topIssues } from './report/verdict.js';

export interface LlmUsage {
  total: number;
  max: number;
  byFlow: Record<string, number>;
}

/**
 * What the terminal shows when a run is done (SPEC §5.1): the verdict, the three problems to fix
 * first, and where the report is. Plain lines, so a test can read exactly what a user reads.
 */
export function summaryLines(report: Report, htmlPath: string, llm?: LlmUsage): string[] {
  const lines = [
    '',
    `Verdict: ${VERDICT_LABEL[report.verdict]}`,
    `  ${countsLine(report.counts)}`,
    `  ${SEVERITY_LEGEND}`,
    `  ${coverageLine(report)}`,
  ];
  const top = topIssues(report.findings);
  if (top.length > 0) {
    lines.push('', 'Fix these first:');
    top.forEach((finding, index) =>
      lines.push(`  ${index + 1}. [${finding.severity}] ${finding.title}`),
    );
  }
  if (llm) {
    const perFlow = Object.entries(llm.byFlow)
      .map(([flow, calls]) => `${flow} ${calls}`)
      .join(', ');
    lines.push('', `AI calls used: ${llm.total} of ${llm.max}${perFlow ? ` (${perFlow})` : ''}`);
  }
  lines.push('', `Report: ${htmlPath}`, '');
  return lines;
}
