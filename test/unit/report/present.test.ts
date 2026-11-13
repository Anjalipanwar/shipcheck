import { describe, expect, it } from 'vitest';
import {
  countsLine,
  formatDate,
  formatDuration,
  groupFindings,
  groupOf,
  modelLine,
  runCaveats,
} from '../../../src/report/present.js';
import { topIssues } from '../../../src/report/verdict.js';
import { finding, makeReport } from './fixtures.js';

describe('grouping (SPEC §5.3 "grouped by flow")', () => {
  it('puts a finding in the section of its flow', () => {
    expect(groupOf({ category: 'functional', flow: 'signup' })).toBe('signup');
    expect(groupOf({ category: 'functional', flow: 'core' })).toBe('core');
    expect(groupOf({ category: 'mobile', flow: 'mobile' })).toBe('mobile');
  });

  it('keeps topics such as security together, whatever flow they were found in', () => {
    expect(groupOf({ category: 'security', flow: 'signup' })).toBe('security');
    expect(groupOf({ category: 'errors', flow: 'login' })).toBe('errors');
    expect(groupOf({ category: 'seo' })).toBe('seo');
    expect(groupOf({ category: 'accessibility' })).toBe('accessibility');
    expect(groupOf({ category: 'performance' })).toBe('performance');
  });

  it('falls back to the category when there is no flow', () => {
    expect(groupOf({ category: 'forms' })).toBe('forms');
    expect(groupOf({ category: 'mobile' })).toBe('mobile');
    expect(groupOf({ category: 'functional' })).toBe('general');
    expect(groupOf({ category: 'coverage' })).toBe('other');
  });

  it('returns only non-empty groups, in report order, and loses no finding', () => {
    const findings = [
      finding({ title: 'a', category: 'seo' }),
      finding({ title: 'b', category: 'functional', flow: 'login' }),
      finding({ title: 'c', category: 'security' }),
      finding({ title: 'd', category: 'functional', flow: 'landing' }),
      finding({ title: 'e', category: 'seo' }),
    ];
    const groups = groupFindings(findings);
    expect(groups.map((g) => g.label)).toEqual([
      'Landing page',
      'Login',
      'Security',
      'Search and sharing (SEO)',
    ]);
    expect(groups.flatMap((g) => g.findings.map((f) => f.title)).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(groupFindings([])).toEqual([]);
  });
});

describe('fix these first', () => {
  it('takes the three most severe problems and never an Info note', () => {
    const top = topIssues([
      finding({ title: 'info', severity: 'info' }),
      finding({ title: 'minor 1' }),
      finding({ title: 'major', severity: 'major' }),
      finding({ title: 'minor 2' }),
      finding({ title: 'blocker', severity: 'blocker' }),
    ]);
    expect(top.map((f) => f.title)).toEqual(['blocker', 'major', 'minor 1']);
    expect(topIssues([finding({ severity: 'info' })])).toEqual([]);
  });
});

describe('wording helpers', () => {
  it('formats dates in UTC, whatever the machine’s time zone', () => {
    expect(formatDate('2026-11-13T17:57:51.039Z')).toBe('13 November 2026, 17:57 UTC');
    expect(formatDate('2026-01-02T03:04:00+02:00')).toBe('2 January 2026, 01:04 UTC');
    expect(formatDate('not a date')).toBe('not a date');
  });

  it('formats durations for people', () => {
    expect(formatDuration(0)).toBe('1 second');
    expect(formatDuration(2075)).toBe('2 seconds');
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(192_400)).toBe('3 min 12 s');
  });

  it('writes the counts line and the model line', () => {
    expect(countsLine({ blocker: 1, major: 0, minor: 5, info: 1 })).toBe(
      '1 blocker · 0 major · 5 minor · 1 info',
    );
    const meta = makeReport().meta;
    expect(modelLine(meta)).toBe('None — automatic checks only');
    expect(modelLine({ ...meta, mode: 'full', model: 'gemini-x', llmCalls: 1 })).toBe(
      'gemini-x (1 AI call)',
    );
    expect(modelLine({ ...meta, mode: 'full', model: 'gemini-x', llmCalls: 42 })).toBe(
      'gemini-x (42 AI calls)',
    );
  });

  it('adds honest caveats for runs without AI and for runs that stopped early', () => {
    const report = makeReport();
    expect(runCaveats(report)).toHaveLength(1);
    expect(runCaveats(report)[0]).toMatch(/automatic checks only/);
    const full = { ...report, meta: { ...report.meta, mode: 'full' as const } };
    expect(runCaveats(full)).toEqual([]);
    const partial = { ...full, meta: { ...full.meta, partial: true } };
    expect(runCaveats(partial)[0]).toMatch(/stopped early/);
  });
});
