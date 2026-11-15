import { z } from 'zod';
import type { Finding, Severity } from '../report/schema.js';
import { PROMPTS } from './prompts.js';

/**
 * The judge (SPEC §8 step 7): the last look at the findings before the report is written.
 *
 * In code, always:  no evidence → no finding;  near-duplicates are merged.
 * With the model, once:  findings that rest on what the AI saw are reworded into plain English
 * and get a fix prompt. The model may only reword. Rule, category, flow, device, severity,
 * evidence and confidence stay as the code set them, and the model can neither add nor drop a
 * finding — the texts it reads come partly from the tested page, which is not trusted.
 * If the model is unavailable, over budget, or answers badly, the original wording stays.
 */

/** Words a non-technical reader should not have to know. Checked in titles (BUILD_PLAN M6). */
const JARGON =
  /\b(DOM|selectors?|xpath|stack ?traces?|null pointer|undefined is not|exception|payload|endpoint|API call|HTTP \d{3}|status code|regex|async|callback|middleware|viewport|CSS|JavaScript error|console)\b/i;

export const hasJargon = (text: string): boolean => JARGON.test(text);

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };
const MAX_MERGED = 6;

const hasEvidence = (finding: Finding): boolean =>
  finding.evidence.screenshots.length > 0 ||
  (finding.evidence.logs ?? []).length > 0 ||
  Boolean(finding.evidence.url);

const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const union = (a: readonly string[], b: readonly string[]): string[] =>
  [...new Set([...a, ...b])].slice(0, MAX_MERGED);

/** Two findings that say the same thing: same category and the same title, wording aside. */
const sameProblem = (a: Finding, b: Finding): boolean =>
  a.category === b.category &&
  (a.severity === 'info') === (b.severity === 'info') &&
  normal(a.title) === normal(b.title);

/** Merges near-duplicates: the worse severity wins, the evidence of both is kept. */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const kept: Finding[] = [];
  for (const finding of findings) {
    const at = kept.findIndex((other) => sameProblem(other, finding));
    const twin = kept[at];
    if (!twin) {
      kept.push(finding);
      continue;
    }
    const [lead, other] =
      SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[twin.severity]
        ? [finding, twin]
        : [twin, finding];
    kept[at] = {
      ...lead,
      device: lead.device === other.device ? lead.device : 'both',
      evidence: {
        ...lead.evidence,
        screenshots: union(lead.evidence.screenshots, other.evidence.screenshots),
        logs: union(lead.evidence.logs ?? [], other.evidence.logs ?? []),
      },
    };
  }
  return kept;
}

const RewordSchema = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      whatHappened: z.string(),
      whyItMatters: z.string(),
      fixPrompt: z.string(),
    }),
  ),
});
type Reworded = z.infer<typeof RewordSchema>['findings'][number];

const LIMITS = { title: 110, whatHappened: 600, whyItMatters: 300, fixPrompt: 1200 } as const;
const links = (text: string): string[] =>
  (text.match(/https?:\/\/[^\s"'”)]+/g) ?? []).map((link) => link.replace(/[.,;:!?]+$/, ''));

/** A rewording that says there is no problem contradicts the finding it rewords. */
const DENIES =
  /\b(no (problems?|issues?|bugs?|errors?)(?! (message|messages|text|hint|notice|warning))( (were |was )?found)?|nothing (is |was )?(wrong|broken)|not a (bug|problem|real)|works? (fine|correctly|as expected|as intended|properly|perfectly)|false (alarm|positive)|can be ignored|was created successfully)\b/i;
/** True if the text, quoted app messages aside, claims that there is no problem. */
export const deniesProblem = (text: string): boolean => DENIES.test(text.replace(/“[^”]*”/g, ''));
const quotes = (text: string): string[] => text.match(/“[^”]{3,}”/g) ?? [];

/**
 * A rewording is used only if it is complete, short, jargon-free, adds no new link, keeps every
 * quoted message of the original, and does not turn the finding into "no problem".
 */
export function acceptable(original: Finding, next: Reworded): boolean {
  const fields = ['title', 'whatHappened', 'whyItMatters', 'fixPrompt'] as const;
  if (fields.some((field) => next[field].trim().length < 8)) return false;
  if (fields.some((field) => next[field].length > LIMITS[field])) return false;
  if (hasJargon(next.title)) return false;
  // Quoted app messages are data and may say anything; the judge's own words may not deny.
  if (deniesProblem(fields.map((field) => next[field]).join(' '))) return false;
  if (!quotes(original.whatHappened).every((quote) => next.whatHappened.includes(quote))) {
    return false;
  }
  const known = new Set(
    links(
      [
        original.title,
        original.whatHappened,
        original.whyItMatters,
        original.fixPrompt ?? '',
        original.evidence.url ?? '',
        ...original.stepsToReproduce,
      ].join(' '),
    ),
  );
  return links(fields.map((field) => next[field]).join(' ')).every((link) => known.has(link));
}

/** Findings worth the model's time: problems that rest on what the AI saw, or lack a fix prompt. */
const needsRewording = (finding: Finding): boolean =>
  finding.severity !== 'info' && (finding.confidence === 'ai-judgement' || !finding.fixPrompt);

export type Ask = <T extends z.ZodObject>(instruction: string, schema: T) => Promise<z.infer<T>>;

export interface JudgeResult {
  findings: Finding[];
  /** Titles of possible problems left out because nothing backs them up. */
  withoutEvidence: string[];
  /** How many findings the model reworded (0 when it was not asked or its answer was not used). */
  reworded: number;
}

export async function judge(findings: readonly Finding[], ask?: Ask): Promise<JudgeResult> {
  const backed = findings.filter((finding) => finding.severity === 'info' || hasEvidence(finding));
  const withoutEvidence = findings
    .filter((finding) => !backed.includes(finding))
    .map((finding) => finding.title);
  const merged = dedupeFindings(backed);

  const candidates = merged.filter(needsRewording);
  if (!ask || candidates.length === 0) return { findings: merged, withoutEvidence, reworded: 0 };

  let answers: Reworded[] = [];
  try {
    const input = candidates.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      whatHappened: finding.whatHappened,
      whyItMatters: finding.whyItMatters,
      stepsToReproduce: finding.stepsToReproduce,
      fixPrompt: finding.fixPrompt ?? '',
    }));
    answers = (await ask(PROMPTS.judge(JSON.stringify(input)), RewordSchema)).findings;
  } catch {
    // No budget, no quota, or an answer of the wrong shape: the original wording stays.
    return { findings: merged, withoutEvidence, reworded: 0 };
  }

  let reworded = 0;
  const result = merged.map((finding) => {
    const next = answers.find((answer) => answer.id === finding.id);
    if (!next || !candidates.includes(finding) || !acceptable(finding, next)) return finding;
    reworded += 1;
    return {
      ...finding,
      title: next.title.trim(),
      whatHappened: next.whatHappened.trim(),
      whyItMatters: next.whyItMatters.trim(),
      fixPrompt: next.fixPrompt.trim(),
    };
  });
  return { findings: result, withoutEvidence, reworded };
}
