import type { Config } from './config.js';
import { EXIT } from './program.js';
import type { Report } from './report/schema.js';

/**
 * SPEC §5.1: 0 = passed the --fail-on threshold, 1 = problems at or above it, 3 = stopped by the
 * time limit with nothing at that level found (the results are incomplete). Problems found win
 * over the time limit; --fail-on none always gives 0. (2 = ShipCheck itself could not run —
 * decided where that happens, not here.)
 */
export function exitCodeFor(
  counts: Pick<Report['counts'], 'blocker' | 'major'>,
  failOn: Config['failOn'],
  stoppedBy?: Report['meta']['stoppedBy'],
): number {
  if (failOn === 'none') return EXIT.passed;
  if (counts.blocker > 0) return EXIT.issuesFound;
  if (failOn === 'major' && counts.major > 0) return EXIT.issuesFound;
  return stoppedBy === 'time-limit' ? EXIT.stoppedByTimeLimit : EXIT.passed;
}
