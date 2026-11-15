import type { FlowResult, Gap } from './flows/types.js';
import { areasOf } from './report/areas.js';
import { ADVICE } from './report/present.js';
import {
  CoverageAreaSchema,
  type CoverageArea,
  type CoverageEntry,
  type Finding,
  type Severity,
} from './report/schema.js';

/**
 * Records, while the run happens, what became of each area of the "What this report covers"
 * table (owner decisions 2026-11-15). The runner marks each area where it knows the outcome;
 * an area nobody marked gets the fallback. The verdict is derived from the result.
 */

/** What the runner knows about an area before findings are counted. */
export interface Outcome {
  state: 'tested' | 'not-tested' | 'skipped' | 'absent';
  /** Why — for "not-tested" it ends with what the user can do. */
  note?: string | undefined;
}

/** "reason. What you can do." */
export const withAdvice = (reason: string, advice: string): string =>
  `${reason.replace(/[.\s]+$/, '')}. ${advice}.`;

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, info: 3 };

export class CoverageRecorder {
  private readonly marks = new Map<CoverageArea, Outcome[]>();

  mark(area: CoverageArea, outcome: Outcome): void {
    this.marks.set(area, [...(this.marks.get(area) ?? []), outcome]);
  }

  /** Nothing was tested, whatever was marked before (e.g. the home page did not load). */
  failAll(note: string): void {
    this.marks.clear();
    for (const area of CoverageAreaSchema.options) this.mark(area, { state: 'not-tested', note });
  }

  /**
   * One entry per area, in table order. An area marked several times (basic security is three
   * checks) is "not tested" if any part was. Problems found in an area always show, even if
   * the area could only partly be tested.
   */
  build(findings: readonly Finding[], fallback: (area: CoverageArea) => Outcome): CoverageEntry[] {
    return CoverageAreaSchema.options.map((area) => {
      const outcome = combine(this.marks.get(area) ?? [fallback(area)]);
      const found = findings.filter((finding) => areasOf(finding).includes(area));
      const worst = [...found].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      )[0];
      if (worst) {
        const blocked = outcome.state === 'not-tested';
        return {
          area,
          state: 'problems',
          problems: found.length,
          worst: worst.severity,
          ...(blocked && outcome.note ? { note: outcome.note } : {}),
          ...(blocked ? { partial: true } : {}),
        };
      }
      return {
        area,
        state: outcome.state === 'tested' ? 'no-problems' : outcome.state,
        ...(outcome.state !== 'tested' && outcome.note ? { note: outcome.note } : {}),
      };
    });
  }
}

/** Several outcomes for one area: blocked beats tested beats skipped beats absent. */
export function combine(outcomes: readonly Outcome[]): Outcome {
  const blocked = outcomes.filter((o) => o.state === 'not-tested');
  if (blocked.length > 0) {
    const notes = [...new Set(blocked.flatMap((o) => (o.note ? [o.note] : [])))];
    return { state: 'not-tested', ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  }
  return (
    outcomes.find((o) => o.state === 'tested') ??
    outcomes.find((o) => o.state === 'skipped') ??
    outcomes[0] ?? { state: 'not-tested' }
  );
}

/**
 * The reason part of a "What we couldn't test" line. Flows write "<what> — <reason>"; only the
 * first sentence is kept, so the note stays short.
 */
export function reasonOf(line: string): string {
  const reason = line.includes(' — ') ? line.slice(line.indexOf(' — ') + 3) : line;
  const sentence = reason.split(/\.\s/)[0] ?? reason;
  return sentence.replace(/\.$/, '').trim();
}

const gapNote = (gap: Gap): string =>
  gap.kind === 'blocked' ? withAdvice(gap.reason, gap.action ?? ADVICE.byHand) : gap.reason;

/**
 * What became of one flow. Blocked (email confirmation, CAPTCHA, a limit, an error…) → not
 * tested; left out by the user's choice → skipped; the app has no such part → absent; otherwise
 * tested — also when it found a bug.
 */
export function flowOutcome(result: FlowResult): Outcome {
  const blocked = result.gaps.filter((gap) => gap.kind === 'blocked');
  if (blocked.length > 0) {
    return { state: 'not-tested', note: [...new Set(blocked.map(gapNote))].join(' ') };
  }
  if (result.status !== 'completed') {
    return { state: 'not-tested', note: withAdvice('this part could not finish', ADVICE.retry) };
  }
  const choice = result.gaps.find((gap) => gap.kind === 'choice');
  if (choice) return { state: 'skipped', note: choice.reason };
  const absent = result.gaps.find((gap) => gap.kind === 'absent');
  if (absent) return { state: 'absent', note: absent.reason };
  return { state: 'tested' };
}

/**
 * "Using it on a phone" is several flows in one row. Blocked flows are named with their
 * reason; flows that share a reason are named together, so the note stays short.
 */
export function phoneOutcome(flows: readonly (Outcome & { label: string })[]): Outcome {
  const blocked = flows.filter((flow) => flow.state === 'not-tested');
  if (blocked.length > 0) {
    const byReason = new Map<string, string[]>();
    for (const flow of blocked) {
      byReason.set(flow.note ?? '', [...(byReason.get(flow.note ?? '') ?? []), flow.label]);
    }
    return {
      state: 'not-tested',
      note: [...byReason]
        .map(([reason, labels]) => `${labels.join(', ')}${reason ? `: ${reason}` : ''}`)
        .join(' '),
    };
  }
  const { state, note } = combine(flows);
  return { state, note };
}
