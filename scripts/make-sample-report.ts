/*
 * Makes the sample report in examples/reports/ by running ShipCheck (automatic checks only, no
 * AI key needed) against the pretend app with planted bugs:  npm run sample
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { writeReport } from '../src/report/write.js';
import { runShipCheck } from '../src/runner.js';
import { startFixtureServer } from '../test/helpers/fixture-server.js';

const target = fileURLToPath(new URL('../examples/reports/', import.meta.url));
const app = await startFixtureServer({ port: 4173 });
const work = await mkdtemp(join(tmpdir(), 'shipcheck-sample-'));
try {
  const result = await runShipCheck(loadConfig(app.url, { yes: true, ai: false }, {}), {
    progress: (line) => process.stdout.write(`  ${line}\n`),
  });
  await writeReport(work, result.report, result.screenshots, result.redact);
  await mkdir(target, { recursive: true });
  await copyFile(join(work, 'report.html'), join(target, 'buggy-app.html'));
  await copyFile(join(work, 'report.md'), join(target, 'buggy-app.md'));
  // The project page (docs-site/) shows the same report.
  await copyFile(
    join(work, 'report.html'),
    fileURLToPath(new URL('../docs-site/sample-report.html', import.meta.url)),
  );
  process.stdout.write(`\nWritten: ${join(target, 'buggy-app.html')} and buggy-app.md\n`);
} finally {
  await rm(work, { recursive: true, force: true });
  await app.close();
}
