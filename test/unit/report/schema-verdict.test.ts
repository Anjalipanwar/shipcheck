import { describe, expect, it } from 'vitest';
import {
  ReportSchema,
  findingId,
  makeFinding,
  type FindingInput,
  type Severity,
} from '../../../src/report/schema.js';
import { computeVerdict, countBySeverity, rankFindings } from '../../../src/report/verdict.js';
import { coverageFor, makeReport } from './fixtures.js';

const base: FindingInput = {
  rule: 'test/rule',
  title: 'Something is wrong',
  severity: 'minor',
  category: 'functional',
  device: 'desktop',
  whatHappened: 'It broke.',
  whyItMatters: 'People notice.',
  stepsToReproduce: ['Open the page.'],
  evidence: { screenshots: [], logs: ['a log line'] },
  confidence: 'verified',
};
const finding = (severity: Severity, title = `${severity} issue`) =>
  makeFinding({ ...base, severity, title });

describe('makeFinding', () => {
  it('refuses a finding without any evidence', () => {
    expect(() => makeFinding({ ...base, evidence: { screenshots: [] } })).toThrow(/evidence/);
    expect(() => makeFinding({ ...base, evidence: { screenshots: [], logs: [] } })).toThrow(
      /evidence/,
    );
  });

  it('accepts a screenshot or a log line as evidence', () => {
    expect(
      makeFinding({ ...base, evidence: { screenshots: ['screenshots/01.jpg'] } }).id,
    ).toBeTruthy();
    expect(makeFinding(base).id).toBeTruthy();
  });

  it('gives the same id for the same category, flow and title, and a different one otherwise', () => {
    expect(makeFinding(base).id).toBe(
      makeFinding({ ...base, whatHappened: 'Different words.' }).id,
    );
    expect(makeFinding(base).id).not.toBe(makeFinding({ ...base, title: 'Another title' }).id);
    expect(findingId({ ...base, flow: 'login' })).not.toBe(findingId(base));
  });

  it('rejects unknown severities and empty titles', () => {
    expect(() => makeFinding({ ...base, severity: 'critical' as Severity })).toThrow();
    expect(() => makeFinding({ ...base, title: '' })).toThrow();
  });
});

describe('verdict rules (SPEC §5.3, owner decision 2026-11-15)', () => {
  const allTested = coverageFor('full');
  const full = { mode: 'full' as const, coverage: allTested };
  const noAi = { mode: 'no-ai' as const, coverage: coverageFor('no-ai') };

  it('full run, everything tested: no findings or only minor/info → ready', () => {
    expect(computeVerdict([], full)).toBe('ready');
    expect(computeVerdict([finding('minor'), finding('info')], full)).toBe('ready');
  });
  it('full run: any major, no blocker → fix before launch', () => {
    expect(computeVerdict([finding('minor'), finding('major')], full)).toBe('fix-before-launch');
  });
  it('full run: any blocker → not ready, even next to majors', () => {
    expect(computeVerdict([finding('major'), finding('blocker'), finding('info')], full)).toBe(
      'not-ready',
    );
  });
  it('full run with an untested area (stopped early, skipped, blocked) → partly tested, never ready', () => {
    const stopped = {
      mode: 'full' as const,
      coverage: coverageFor('full', { core: 'stopped early' }),
    };
    expect(computeVerdict([], stopped)).toBe('partly-tested');
    expect(computeVerdict([finding('minor')], stopped)).toBe('partly-tested');
    // Problems found still decide: an incomplete run can always say "not ready".
    expect(computeVerdict([finding('major')], stopped)).toBe('fix-before-launch');
    expect(computeVerdict([finding('blocker')], stopped)).toBe('not-ready');
  });
  it('skipped by the user’s choice or not in the app does not block “ready”; a partly tested area does', () => {
    const byChoice = {
      mode: 'full' as const,
      coverage: coverageFor('full', {
        signup: { state: 'skipped', note: 'you gave a test account' },
        forms: { state: 'absent', note: 'no form was found' },
        'phone-flows': { state: 'skipped', note: 'you used --skip-mobile' },
      }),
    };
    expect(computeVerdict([], byChoice)).toBe('ready');
    const minorInBlockedArea = coverageFor('full', { seo: 'could not finish. Try again.' }, [
      makeFinding({ ...base, severity: 'minor', category: 'seo' }),
    ]);
    expect(minorInBlockedArea.find((e) => e.area === 'seo')).toMatchObject({
      state: 'problems',
      partial: true,
    });
    expect(computeVerdict([finding('minor')], { mode: 'full', coverage: minorInBlockedArea })).toBe(
      'partly-tested',
    );
  });
  it('--no-ai: nothing or only Info → checks passed; anything else → checks found issues', () => {
    expect(computeVerdict([], noAi)).toBe('checks-passed');
    expect(computeVerdict([finding('info')], noAi)).toBe('checks-passed');
    expect(computeVerdict([finding('minor')], noAi)).toBe('checks-found-issues');
    expect(computeVerdict([finding('blocker')], noAi)).toBe('checks-found-issues');
  });

  it('--no-ai can never be “ready”: every mix of severities and coverage', () => {
    const severities: Severity[] = ['blocker', 'major', 'minor', 'info'];
    const mixes = Array.from({ length: 16 }, (_, bits) =>
      severities.filter((_, i) => bits & (1 << i)).map((s) => finding(s)),
    );
    const coverages = [
      coverageFor('no-ai'),
      coverageFor('full'),
      coverageFor('no-ai', { seo: 'x' }),
    ];
    for (const findings of mixes) {
      for (const coverage of coverages) {
        const verdict = computeVerdict(findings, { mode: 'no-ai', coverage });
        expect(['checks-passed', 'checks-found-issues']).toContain(verdict);
      }
    }
  });

  it('the report schema refuses a verdict that promises more than was tested', () => {
    const ok = makeReport();
    expect(() => ReportSchema.parse(ok)).not.toThrow();
    expect(() => ReportSchema.parse({ ...ok, verdict: 'ready' })).toThrow(/--no-ai/);
    expect(() => ReportSchema.parse({ ...ok, verdict: 'not-ready' })).toThrow(/--no-ai/);
    const fullReport = makeReport([], {
      meta: { ...ok.meta, mode: 'full', model: 'm', llmCalls: 3 },
    });
    expect(fullReport.verdict).toBe('ready');
    expect(() => ReportSchema.parse(fullReport)).not.toThrow();
    expect(() =>
      ReportSchema.parse({ ...fullReport, coverage: coverageFor('full', { login: 'skipped' }) }),
    ).toThrow(/marked not tested/);
    expect(() => ReportSchema.parse({ ...fullReport, verdict: 'checks-passed' })).toThrow(
      /--no-ai runs/,
    );
    // An empty or incomplete table cannot sneak a "ready" through.
    expect(() => ReportSchema.parse({ ...fullReport, coverage: [] })).toThrow(/each area/);
    expect(() =>
      ReportSchema.parse({
        ...fullReport,
        coverage: [...fullReport.coverage, fullReport.coverage[0]],
      }),
    ).toThrow(/each area/);
  });

  it('counts per severity', () => {
    expect(countBySeverity([finding('minor'), finding('minor'), finding('blocker')])).toEqual({
      blocker: 1,
      major: 0,
      minor: 2,
      info: 0,
    });
  });

  it('ranks most severe first and keeps the original order within a severity', () => {
    const ranked = rankFindings([
      finding('info'),
      finding('minor', 'first minor'),
      finding('blocker'),
      finding('minor', 'second minor'),
      finding('major'),
    ]);
    expect(ranked.map((f) => f.title)).toEqual([
      'blocker issue',
      'major issue',
      'first minor',
      'second minor',
      'info issue',
    ]);
  });
});
