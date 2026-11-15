import type { Config } from './config.js';
import { EXIT } from './program.js';
import type { Report } from './report/schema.js';

/**
 * SPEC §5.1: 0 = passed the --fail-on threshold, 1 = problems at or above it. (2 = ShipCheck
 * itself could not run — decided where that happens, not here.)
 */
export function exitCodeFor(
  counts: Pick<Report['counts'], 'blocker' | 'major'>,
  failOn: Config['failOn'],
): number {
  if (failOn === 'none') return EXIT.passed;
  if (counts.blocker > 0) return EXIT.issuesFound;
  return failOn === 'major' && counts.major > 0 ? EXIT.issuesFound : EXIT.passed;
}
