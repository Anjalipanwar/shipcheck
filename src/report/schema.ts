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
export const VerdictSchema = z.enum(['ready', 'fix-before-launch', 'not-ready']);

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

export const ReportSchema = z.object({
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
  actionLog: z.array(ActionLogEntrySchema),
});

export type Severity = z.infer<typeof SeveritySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
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
