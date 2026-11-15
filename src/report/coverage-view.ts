import { AUTOMATIC_AREAS, VISITOR_AREAS, areasOf } from './areas.js';
import {
  AI_KEY_HELP,
  AREA_LABEL,
  CHECK_TYPE_LABEL,
  COVERAGE_DID,
  COVERAGE_NEXT_FULL,
  COVERAGE_NEXT_LABEL,
  COVERAGE_NEXT_NO_AI,
  COVERAGE_TABLE_CAPTION,
  COVERAGE_TITLE,
  COVERAGE_WHY_DIFFER,
  GROUP_LABEL,
  STATE_ICON,
  fullCheckCommand,
  otherProblemsText,
  partialNote,
  stateText,
} from './present.js';
import type { CoverageArea, CoverageEntry, Finding, Report } from './schema.js';

/**
 * "What this report covers" as plain data. The HTML, Markdown and step-summary renderers only
 * format this, so every format shows the same words.
 */
export interface CoverageRow {
  label: string;
  state: CoverageEntry['state'];
  icon: string;
  /** "No problems found", "2 problems", "Not tested: …", "Skipped by your choice: …". */
  text: string;
  /** Problems only: the worst severity (for the colour) and the findings to link to. */
  worst?: CoverageEntry['worst'];
  findings: Finding[];
  /** Problems were found, but part of the area could not be tested. */
  partial?: string;
}

export interface CoverageView {
  title: string;
  checkType: string;
  did: string;
  tableCaption: string;
  groups: { heading: string; rows: CoverageRow[] }[];
  /** Problems outside every row, so the table never looks cleaner than the counts. */
  other?: string;
  /** Automatic-only reports: why a full check often finds more. */
  whyDiffer?: string;
  nextLabel: string;
  next: string;
  /** Automatic-only reports: the command for the full check, and where to get a key. */
  command?: string;
  help: { text: string; url: string };
}

export function coverageView(report: Pick<Report, 'meta' | 'coverage' | 'findings'>): CoverageView {
  const full = report.meta.mode === 'full';
  const rows = (areas: readonly CoverageArea[]): CoverageRow[] =>
    areas.flatMap((area) => {
      const entry = report.coverage.find((candidate) => candidate.area === area);
      if (!entry) return [];
      const partial = partialNote(entry);
      return [
        {
          label: AREA_LABEL[area],
          state: entry.state,
          icon: STATE_ICON[entry.state],
          text: stateText(entry),
          ...(entry.state === 'problems' ? { worst: entry.worst } : {}),
          findings:
            entry.state === 'problems'
              ? report.findings.filter((finding) => areasOf(finding).includes(area))
              : [],
          ...(partial ? { partial } : {}),
        },
      ];
    });
  const others = report.findings.filter(
    (finding) => finding.severity !== 'info' && areasOf(finding).length === 0,
  ).length;
  return {
    title: COVERAGE_TITLE,
    checkType: CHECK_TYPE_LABEL[report.meta.mode],
    did: COVERAGE_DID[report.meta.mode],
    tableCaption: COVERAGE_TABLE_CAPTION,
    groups: [
      { heading: GROUP_LABEL.visitor, rows: rows(VISITOR_AREAS) },
      { heading: GROUP_LABEL.automatic, rows: rows(AUTOMATIC_AREAS) },
    ],
    ...(others > 0 ? { other: otherProblemsText(others) } : {}),
    ...(full ? {} : { whyDiffer: COVERAGE_WHY_DIFFER }),
    nextLabel: COVERAGE_NEXT_LABEL[report.meta.mode],
    next: full ? COVERAGE_NEXT_FULL : COVERAGE_NEXT_NO_AI,
    ...(full ? {} : { command: fullCheckCommand(report.meta.url) }),
    help: AI_KEY_HELP,
  };
}
