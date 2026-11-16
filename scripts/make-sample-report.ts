/*
 * Makes the sample reports in examples/reports/ by running ShipCheck against the pretend app
 * with planted bugs:
 *   npm run sample            automatic checks only (no AI key needed)
 *   npm run sample -- --full  the full check — uses the AI key from ".env" and its quota
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseModel } from '../src/ai/models.js';
import { loadConfig } from '../src/config.js';
import { writeReport } from '../src/report/write.js';
import { runShipCheck } from '../src/runner.js';
import { startFixtureServer } from '../test/helpers/fixture-server.js';

const full = process.argv.includes('--full');
const name = full ? 'buggy-app-full' : 'buggy-app';
const pageCopy = full ? 'sample-report-full.html' : 'sample-report.html';
if (full && existsSync('.env')) process.loadEnvFile('.env');
const model = full ? chooseModel(process.env) : undefined;

/** Added under the title of the sample's Markdown version. */
const SAMPLE_NOTE = (file: string): string =>
  `> **Sample report.** Made by ShipCheck from a pretend app with planted bugs. The screenshots named under “Evidence” are shown in the HTML version of this report ([${file}.html](${file}.html)); a real report folder also contains them as files.`;

const target = fileURLToPath(new URL('../examples/reports/', import.meta.url));
const app = await startFixtureServer({ port: 4173 });
const work = await mkdtemp(join(tmpdir(), 'shipcheck-sample-'));
try {
  const result = await runShipCheck(
    loadConfig(app.url, { yes: true, ai: full }, {}),
    { progress: (line) => process.stdout.write(`  ${line}\n`) },
    model ? { model } : {},
  );
  await writeReport(work, result.report, result.screenshots, result.redact);
  await mkdir(target, { recursive: true });
  await copyFile(join(work, 'report.html'), join(target, `${name}.html`));
  // A real report folder also holds the screenshot files; the sample keeps only the two report
  // files, so the Markdown version says where the pictures are.
  const markdown = await readFile(join(work, 'report.md'), 'utf8');
  await writeFile(join(target, `${name}.md`), markdown.replace('\n', `\n\n${SAMPLE_NOTE(name)}\n`));
  // The project page (docs-site/) shows the same reports.
  await copyFile(
    join(work, 'report.html'),
    fileURLToPath(new URL(`../docs-site/${pageCopy}`, import.meta.url)),
  );
  if (result.llm)
    process.stdout.write(`\nAI calls used: ${result.llm.total} of ${result.llm.max}\n`);
  process.stdout.write(`\nWritten: ${join(target, name)}.html and .md\n`);
} finally {
  await rm(work, { recursive: true, force: true });
  await app.close();
}
