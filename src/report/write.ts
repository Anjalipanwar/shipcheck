import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Screenshot } from '../browser/evidence.js';
import { ReportSchema, type Report } from './schema.js';

export interface WrittenReport {
  dir: string;
  jsonPath: string;
}

/**
 * Writes report.json and the screenshot files.
 * `redact` is applied to the final text as a last line of defence, so that a password or API
 * key can never reach the disk even if an earlier step forgot to scrub it (SPEC §7.6).
 */
export async function writeReport(
  outDir: string,
  report: Report,
  screenshots: readonly Screenshot[],
  redact: (text: string) => string,
): Promise<WrittenReport> {
  const validated = ReportSchema.parse(report);
  const shotsDir = join(outDir, 'screenshots');
  await mkdir(shotsDir, { recursive: true });

  // Remove screenshots from an earlier run so the folder always matches this report.
  for (const name of await readdir(shotsDir)) {
    if (/^\d{2}-(desktop|mobile)-[a-z0-9-]+\.jpg$/.test(name)) await rm(join(shotsDir, name));
  }
  for (const shot of screenshots) await writeFile(join(outDir, shot.file), shot.data);

  const jsonPath = join(outDir, 'report.json');
  await writeFile(jsonPath, `${redact(JSON.stringify(validated, null, 2))}\n`, 'utf8');
  return { dir: outDir, jsonPath };
}
