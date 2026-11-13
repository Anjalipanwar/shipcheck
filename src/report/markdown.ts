import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  DEVICE_LABEL,
  DISCLAIMER,
  NOT_CHECKED,
  SEVERITY_LABEL,
  VERDICT_LABEL,
  VERDICT_SUMMARY,
  countsLine,
  formatDate,
  formatDuration,
  groupFindings,
  groupOf,
  modelLine,
  runCaveats,
} from './present.js';
import type { Finding, Report } from './schema.js';
import { topIssues } from './verdict.js';

/**
 * Makes text from the tested app safe to place inside Markdown: nothing in it can turn into
 * formatting, a link, an image or raw HTML. Line breaks become spaces.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[\\`*_[\]<>|~]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/^(\s*)([#+-])(\s)/, '$1\\$2$3')
    .replace(/^(\s*\d+)\.(\s)/, '$1\\.$2');
}

/** A code block whose fence is longer than any run of backticks inside it, so it cannot be closed early. */
export function codeBlock(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

const m = escapeMarkdown;

function summaryLines(report: Report): string[] {
  const { meta } = report;
  return [
    `**Verdict: ${VERDICT_LABEL[report.verdict]}** — ${countsLine(report.counts)}`,
    '',
    VERDICT_SUMMARY[report.verdict],
    ...runCaveats(report).flatMap((caveat) => ['', `> **Note:** ${caveat}`]),
    '',
    `- **App:** ${m(meta.url)}`,
    `- **Date:** ${formatDate(meta.startedAt)}`,
    `- **Duration:** ${formatDuration(meta.durationMs)}`,
    `- **AI model:** ${m(modelLine(meta))}`,
    `- **ShipCheck version:** ${m(meta.shipcheckVersion)}`,
  ];
}

function issue(finding: Finding): string[] {
  const { evidence } = finding;
  const lines = [
    `#### ${m(finding.title)}`,
    '',
    `**${SEVERITY_LABEL[finding.severity]}** · ${CATEGORY_LABEL[finding.category]} · ${DEVICE_LABEL[finding.device]} · ${CONFIDENCE_LABEL[finding.confidence]}`,
    '',
    `**What happened:** ${m(finding.whatHappened)}`,
    '',
    `**Why it matters:** ${m(finding.whyItMatters)}`,
    '',
  ];
  if (finding.stepsToReproduce.length > 0) {
    lines.push('**Steps to reproduce:**', '');
    finding.stepsToReproduce.forEach((step, index) => lines.push(`${index + 1}. ${m(step)}`));
    lines.push('');
  }
  lines.push('**Evidence:**', '');
  if (evidence.url) lines.push(`- Where: ${m(evidence.url)}`);
  for (const file of evidence.screenshots) lines.push(`- Screenshot: ${m(file)}`);
  if (evidence.url || evidence.screenshots.length > 0) lines.push('');
  if (evidence.logs && evidence.logs.length > 0) {
    lines.push(codeBlock(evidence.logs.join('\n')), '');
  }
  if (finding.fixPrompt?.trim()) {
    lines.push(
      '**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):',
      '',
      codeBlock(finding.fixPrompt.trim()),
      '',
    );
  }
  return lines;
}

function bullets(lines: readonly string[], empty: string): string[] {
  return lines.length === 0 ? [empty] : lines.map((line) => `- ${m(line)}`);
}

/** report.md: the same content and order as report.html, readable as plain text. */
export function renderMarkdown(report: Report): string {
  const top = topIssues(report.findings);
  const lines = ['# ShipCheck pre-launch report', '', ...summaryLines(report), ''];

  lines.push('## Fix these first', '');
  if (top.length === 0) {
    lines.push('Nothing urgent. ShipCheck found no problems that need fixing before launch.');
  } else {
    top.forEach((finding, index) =>
      lines.push(`${index + 1}. **${SEVERITY_LABEL[finding.severity]}** — ${m(finding.title)}`),
    );
  }

  lines.push('', `## All issues (${report.findings.length})`, '');
  if (report.findings.length === 0) lines.push('No issues found.', '');
  for (const group of groupFindings(report.findings)) {
    lines.push(`### ${group.label}`, '');
    for (const finding of group.findings) lines.push(...issue(finding));
  }

  lines.push('## What worked', '', ...bullets(report.passed, 'No checks passed in this run.'));
  lines.push(
    '',
    '## What we couldn’t test',
    '',
    ...bullets(report.notTested, 'Nothing — every planned check ran.'),
  );
  lines.push('', '---', '', DISCLAIMER, '', NOT_CHECKED, '');
  return lines.join('\n');
}

/** Short version for the GitHub Actions run page (SPEC §5.2): verdict plus an issue table. */
export function renderStepSummary(report: Report): string {
  const lines = ['## ShipCheck report', '', ...summaryLines(report), ''];
  if (report.findings.length === 0) {
    lines.push('No issues found.');
  } else {
    const groups = new Map(groupFindings(report.findings).map((group) => [group.id, group.label]));
    lines.push('| Severity | Issue | Area | Device |', '| --- | --- | --- | --- |');
    for (const finding of report.findings) {
      lines.push(
        `| ${SEVERITY_LABEL[finding.severity]} | ${m(finding.title)} | ${groups.get(groupOf(finding)) ?? ''} | ${DEVICE_LABEL[finding.device]} |`,
      );
    }
  }
  if (report.notTested.length > 0) {
    lines.push('', '**What we couldn’t test**', '', ...bullets(report.notTested, ''));
  }
  lines.push(
    '',
    'The full report with evidence and fix prompts is in the `shipcheck-report` artifact of this run (open `report.html`).',
    '',
  );
  return lines.join('\n');
}
