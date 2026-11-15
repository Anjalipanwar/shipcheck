import { appendFile } from 'node:fs/promises';
import { renderStepSummary } from './report/markdown.js';
import type { Report } from './report/schema.js';

/**
 * On GitHub Actions, adds the short report (verdict, coverage, issue table) to the run's
 * summary page (SPEC §5.2). GitHub names the file to write to in GITHUB_STEP_SUMMARY; anywhere
 * else nothing happens. Never fails the run: the full report is written regardless.
 */
export async function writeStepSummary(
  report: Report,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  try {
    // The ShipCheck action says under which name it uploads the report folder.
    const artifact = env.SHIPCHECK_ARTIFACT_NAME?.trim() || undefined;
    await appendFile(file, `${renderStepSummary(report, artifact)}\n`);
    return true;
  } catch {
    return false;
  }
}
