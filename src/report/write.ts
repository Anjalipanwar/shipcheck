import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Screenshot } from '../browser/evidence.js';
import { MAX_REPORT_BYTES, renderHtml } from './html.js';
import { renderMarkdown } from './markdown.js';
import { ReportSchema, type Report } from './schema.js';

export interface WrittenReport {
  dir: string;
  jsonPath: string;
  htmlPath: string;
  markdownPath: string;
}

/** Applies `redact` to every piece of text inside a value, however deeply nested. */
export function redactDeep<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]),
    ) as T;
  }
  return value;
}

/**
 * Writes report.json, report.html, report.md and the screenshot files.
 * `redact` is applied to every text in the report first, as a last line of defence, so that a
 * password or API key can never reach the disk even if an earlier step forgot to scrub it
 * (SPEC §7.6). All three files are produced from that one scrubbed copy.
 */
export async function writeReport(
  outDir: string,
  report: Report,
  screenshots: readonly Screenshot[],
  redact: (text: string) => string,
): Promise<WrittenReport> {
  const safe = redactDeep(ReportSchema.parse(report), redact);

  // Render everything before touching the disk: a failure here must not leave half a report.
  let html = renderHtml(safe, screenshots);
  if (Buffer.byteLength(html) > MAX_REPORT_BYTES) {
    // Only possible with an extreme amount of text. Pictures then stay in the folder instead.
    html = renderHtml(safe, screenshots, { maxImageBytes: 0 });
  }
  const markdown = renderMarkdown(safe);
  const json = `${JSON.stringify(safe, null, 2)}\n`;

  const shotsDir = join(outDir, 'screenshots');
  await mkdir(shotsDir, { recursive: true });
  // Remove screenshots from an earlier run so the folder always matches this report.
  for (const name of await readdir(shotsDir)) {
    if (/^\d{2}-(desktop|mobile)-[a-z0-9-]+\.jpg$/.test(name)) await rm(join(shotsDir, name));
  }
  for (const shot of screenshots) await writeFile(join(outDir, shot.file), shot.data);

  const paths = {
    jsonPath: join(outDir, 'report.json'),
    htmlPath: join(outDir, 'report.html'),
    markdownPath: join(outDir, 'report.md'),
  };
  await writeFile(paths.jsonPath, json, 'utf8');
  await writeFile(paths.htmlPath, html, 'utf8');
  await writeFile(paths.markdownPath, markdown, 'utf8');
  return { dir: outDir, ...paths };
}
