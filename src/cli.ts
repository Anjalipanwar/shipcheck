#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { CommanderError } from 'commander';
import { ConfigError, loadConfig, type Config } from './config.js';
import { buildProgram, EXIT } from './program.js';
import { VERDICT_LABEL, countsLine } from './report/present.js';
import type { Report } from './report/schema.js';
import { topIssues } from './report/verdict.js';
import { writeReport } from './report/write.js';
import { runShipCheck } from './runner.js';

const print = (line = ''): void => void process.stdout.write(`${line}\n`);

/** SPEC §7.7: ask once, unless --yes was given or we are running in CI. */
async function confirmOwnership(config: Config): Promise<void> {
  if (config.yes || process.env.CI === 'true') return;
  if (!process.stdin.isTTY) {
    throw new ConfigError(
      'ShipCheck needs you to confirm that you may test this app. Run it in a terminal, or add --yes if you own the app or have permission to test it.',
    );
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(
      `ShipCheck will open ${config.url} and use it like a visitor.\nOnly test apps you own or have permission to test. Continue? (y/N) `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new ConfigError('Stopped. Nothing was tested.');
    }
  } finally {
    readline.close();
  }
}

function exitCodeFor(report: Report, failOn: Config['failOn']): number {
  const { blocker, major } = report.counts;
  if (failOn === 'none') return EXIT.passed;
  if (blocker > 0) return EXIT.issuesFound;
  return failOn === 'major' && major > 0 ? EXIT.issuesFound : EXIT.passed;
}

async function run(urlArg: string, flags: Record<string, unknown>): Promise<number> {
  const config = loadConfig(urlArg, flags, process.env);
  if (!config.noAi) {
    throw new ConfigError(
      'The AI-driven checks (signup, login, main feature, forms, mobile) are not built yet.\nFor now, add --no-ai to run the automatic checks.',
    );
  }
  await confirmOwnership(config);

  print(`\nShipCheck is checking ${config.url}\n`);
  const result = await runShipCheck(config, { progress: (line) => print(`  ${line}`) });
  const outDir = resolve(config.out);
  const written = await writeReport(outDir, result.report, result.screenshots, result.redact);

  const { report } = result;
  print(`\nVerdict: ${VERDICT_LABEL[report.verdict]}`);
  print(`  ${countsLine(report.counts)}`);
  const top = topIssues(report.findings);
  if (top.length > 0) {
    print('\nFix these first:');
    top.forEach((finding, index) =>
      print(`  ${index + 1}. [${finding.severity}] ${finding.title}`),
    );
  }
  print(`\nReport: ${written.htmlPath}\n`);
  return exitCodeFor(report, config.failOn);
}

let exitCode: number = EXIT.passed;
const program = buildProgram(async (url, flags) => {
  exitCode = await run(url, flags);
}).exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    // --help and --version end with code 0; any usage mistake (missing URL, unknown flag)
    // counts as "ShipCheck itself could not run" = exit 2 (SPEC §5.1). Commander already
    // printed a friendly message.
    exitCode = error.exitCode === 0 ? EXIT.passed : EXIT.shipcheckFailed;
  } else if (error instanceof ConfigError) {
    console.error(`\n${error.message}\n`);
    exitCode = EXIT.shipcheckFailed;
  } else {
    // No stack traces for users (SPEC §5.1). SHIPCHECK_DEBUG=1 shows details for bug reports.
    console.error('\nShipCheck hit an unexpected problem and had to stop.');
    if (process.env.SHIPCHECK_DEBUG) console.error(error);
    else console.error('Run again with SHIPCHECK_DEBUG=1 to see technical details.\n');
    exitCode = EXIT.shipcheckFailed;
  }
}

process.exitCode = exitCode;
