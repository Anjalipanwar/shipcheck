import { describe, expect, it } from 'vitest';
import { minutesText } from '../../src/config.js';
import { CoverageRecorder } from '../../src/coverage.js';

describe('time limit helpers (audit A-04)', () => {
  it('says "1 minute" and "10 minutes"', () => {
    expect(minutesText(1)).toBe('1 minute');
    expect(minutesText(10)).toBe('10 minutes');
  });

  it('a copy of the coverage is not changed by work that is still running', () => {
    const recorder = new CoverageRecorder();
    recorder.mark('seo', { state: 'tested' });
    const copy = recorder.clone();
    recorder.mark('links', { state: 'tested' });
    recorder.mark('seo', { state: 'not-tested', note: 'late' });
    const areas = (r: CoverageRecorder) =>
      r
        .build([], () => ({ state: 'not-tested', note: 'ran out of time' }))
        .filter((entry) => entry.state !== 'not-tested')
        .map((entry) => entry.area);
    expect(areas(copy)).toEqual(['seo']);
  });
});
