import type { Finding } from '../report/schema.js';

export interface CheckResult {
  findings: Finding[];
  /** Plain-English lines for the report's "What worked" section. */
  passed: string[];
  /** Plain-English lines for "What we couldn't test". */
  notTested: string[];
}

export const emptyResult = (): CheckResult => ({ findings: [], passed: [], notTested: [] });
