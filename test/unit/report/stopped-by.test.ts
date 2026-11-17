import { describe, expect, it } from 'vitest';
import { ReportSchema } from '../../../src/report/schema.js';
import { makeReport } from './fixtures.js';

describe('report.json: meta.stoppedBy (owner’s decision 2026-11-17)', () => {
  it('is optional: a run that was not stopped has none', () => {
    const report = makeReport();
    expect(ReportSchema.parse(report).meta.stoppedBy).toBeUndefined();
  });
  it('says "time-limit" when the time limit stopped the run', () => {
    const report = makeReport([], { meta: { ...makeReport().meta, stoppedBy: 'time-limit' } });
    expect(ReportSchema.parse(report).meta.stoppedBy).toBe('time-limit');
  });
  it('accepts no other value', () => {
    const report = makeReport();
    expect(() =>
      ReportSchema.parse({ ...report, meta: { ...report.meta, stoppedBy: 'tired' } }),
    ).toThrow();
  });
});
