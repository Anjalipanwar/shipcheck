import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SeveritySchema = z.enum(['blocker', 'major', 'minor', 'info']);
export const CategorySchema = z.enum([
  'functional',
  'mobile',
  'forms',
  'errors',
  'security',
  'seo',
  'accessibility',
  'performance',
  'coverage',
]);
export const FlowSchema = z.enum(['landing', 'signup', 'login', 'core', 'forms', 'mobile']);
export const DeviceSchema = z.enum(['desktop', 'mobile', 'both']);
export const ConfidenceSchema = z.enum(['verified', 'ai-judgement']);
/**
 * Full (AI) runs: ready, fix-before-launch, not-ready, or partly-tested when an area could not be
 * tested. --no-ai runs only ever get the two neutral verdicts (owner decision 2026-11-15): they
 * never used the app like a visitor, so they cannot say "Ready to launch".
 */
export const VerdictSchema = z.enum([
  'ready',
  'fix-before-launch',
  'not-ready',
  'partly-tested',
  'checks-passed',
  'checks-found-issues',
]);
export const NO_AI_VERDICTS: readonly Verdict[] = ['checks-passed', 'checks-found-issues'];

/** The areas of the "What this report covers" table, in table order. */
export const CoverageAreaSchema = z.enum([
  'signup',
  'login',
  'core',
  'forms',
  'phone-flows',
  'phone-layout',
  'errors',
  'links',
  'seo',
  'security',
  'accessibility',
]);
/**
 * What happened in one area (owner decision 2026-11-15):
 * - no-problems: tested, nothing wrong.          - problems: tested, problems found.
 * - not-tested: something blocked testing (keeps the verdict at "partly tested").
 * - skipped: left out by the user's choice.      - absent: the app has no such part.
 */
export const CoverageStateSchema = z.enum([
  'no-problems',
  'problems',
  'not-tested',
  'skipped',
  'absent',
  /** The flow reached a payment step and stopped there, as designed (SPEC §7.2). */
  'payment-stop',
]);
export const CoverageEntrySchema = z.object({
  area: CoverageAreaSchema,
  state: CoverageStateSchema,
  /** state "problems": how many (Info notes do not count) and the worst severity. */
  problems: z.number().int().positive().optional(),
  worst: SeveritySchema.optional(),
  /** Why it was not tested, skipped or absent — ending with what the user can do. */
  note: z.string().optional(),
  /** state "problems" only: part of the area could not be tested (see note). */
  partial: z.boolean().optional(),
});

/** An area that keeps a full run from being "ready": something blocked testing it. */
export const isUntested = (entry: { state: string; partial?: boolean | undefined }): boolean =>
  entry.state === 'not-tested' || entry.partial === true;

export const EvidenceSchema = z.object({
  /** Paths relative to the report folder, e.g. "screenshots/01-landing.jpg". */
  screenshots: z.array(z.string()),
  logs: z.array(z.string()).optional(),
  url: z.string().optional(),
});

export const FindingSchema = z
  .object({
    /** Stable hash of category + flow + title. */
    id: z.string().min(1),
    /** Machine-readable name of what was found, e.g. "seo/missing-description". */
    rule: z.string().min(1),
    title: z.string().min(1),
    severity: SeveritySchema,
    category: CategorySchema,
    flow: FlowSchema.optional(),
    device: DeviceSchema,
    whatHappened: z.string().min(1),
    whyItMatters: z.string().min(1),
    stepsToReproduce: z.array(z.string()),
    evidence: EvidenceSchema,
    fixPrompt: z.string().optional(),
    confidence: ConfidenceSchema,
  })
  // SPEC §8 rule: no finding without evidence.
  .refine((f) => f.evidence.screenshots.length > 0 || (f.evidence.logs?.length ?? 0) > 0, {
    message: 'A finding needs at least one screenshot or log line as evidence',
    path: ['evidence'],
  });

export const ActionLogEntrySchema = z.object({
  step: z.number().int().positive(),
  at: z.string(),
  flow: z.string().optional(),
  device: z.enum(['desktop', 'mobile']),
  /** What we were trying to do, in plain English. */
  intent: z.string(),
  action: z.string(),
  locator: z.string().optional(),
  /** Typed value. Passwords and other secrets are replaced before they get here. */
  value: z.string().optional(),
  url: z.string(),
  result: z.enum(['ok', 'failed', 'blocked']),
  detail: z.string().optional(),
});

export const ReportSchema = z
  .object({
    meta: z.object({
      url: z.string(),
      startedAt: z.string(),
      durationMs: z.number().nonnegative(),
      model: z.string().nullable(),
      shipcheckVersion: z.string(),
      mode: z.enum(['full', 'no-ai']),
      /** True when a budget ran out or the run stopped early. */
      partial: z.boolean(),
      llmCalls: z.number().int().nonnegative(),
      /** AI calls per flow, and the limit for the run (absent in --no-ai runs). */
      llmCallsByFlow: z.record(z.string(), z.number().int().nonnegative()).optional(),
      llmCallLimit: z.number().int().positive().optional(),
    }),
    verdict: VerdictSchema,
    counts: z.object({
      blocker: z.number().int().nonnegative(),
      major: z.number().int().nonnegative(),
      minor: z.number().int().nonnegative(),
      info: z.number().int().nonnegative(),
    }),
    findings: z.array(FindingSchema),
    passed: z.array(z.string()),
    notTested: z.array(z.string()),
    /** What this run tested, area by area (one entry per area, in table order). */
    coverage: z.array(CoverageEntrySchema),
    actionLog: z.array(ActionLogEntrySchema),
  })
  // A verdict may never promise more than the run tested.
  .superRefine((report, ctx) => {
    const neutral = NO_AI_VERDICTS.includes(report.verdict);
    if (report.meta.mode === 'no-ai' && !neutral) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'A --no-ai run only gets “checks-passed” or “checks-found-issues”',
      });
    }
    if (report.meta.mode === 'full' && neutral) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'Neutral verdicts are for --no-ai runs',
      });
    }
    const areas = report.coverage.map((entry) => entry.area);
    if (
      areas.length !== CoverageAreaSchema.options.length ||
      new Set(areas).size !== areas.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'The coverage table needs each area exactly once',
      });
    }
    if (report.verdict === 'ready' && report.coverage.some(isUntested)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: '“ready” is not possible while an area is marked not tested',
      });
    }
  });

export type Severity = z.infer<typeof SeveritySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type CoverageArea = z.infer<typeof CoverageAreaSchema>;
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;
export type CoverageState = z.infer<typeof CoverageStateSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ActionLogEntry = z.infer<typeof ActionLogEntrySchema>;
export type Report = z.infer<typeof ReportSchema>;

export type FindingInput = Omit<Finding, 'id'>;

export function findingId(input: Pick<Finding, 'category' | 'flow' | 'title'>): string {
  return createHash('sha256')
    .update(`${input.category}|${input.flow ?? ''}|${input.title}`)
    .digest('hex')
    .slice(0, 12);
}

/** Builds a validated Finding. Throws if it has no evidence. */
export function makeFinding(input: FindingInput): Finding {
  return FindingSchema.parse({ ...input, id: findingId(input) });
}
