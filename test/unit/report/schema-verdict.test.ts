import { describe, expect, it } from 'vitest';
import {
  findingId,
  makeFinding,
  type FindingInput,
  type Severity,
} from '../../../src/report/schema.js';
import { computeVerdict, countBySeverity, rankFindings } from '../../../src/report/verdict.js';

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

describe('verdict rules (SPEC §5.3)', () => {
  it('no findings → ready', () => {
    expect(computeVerdict([])).toBe('ready');
  });
  it('only minor and info → ready', () => {
    expect(computeVerdict([finding('minor'), finding('info')])).toBe('ready');
  });
  it('any major, no blocker → fix before launch', () => {
    expect(computeVerdict([finding('minor'), finding('major')])).toBe('fix-before-launch');
  });
  it('any blocker → not ready, even next to majors', () => {
    expect(computeVerdict([finding('major'), finding('blocker'), finding('info')])).toBe(
      'not-ready',
    );
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
