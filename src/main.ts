import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CommanderError } from 'commander';
import { chooseModel } from './ai/models.js';
import { ConfigError, loadConfig, readConfigFile } from './config.js';
import { confirmOwnership } from './confirm.js';
import { exitCodeFor } from './exit-code.js';
import { openReport } from './open-report.js';
import { checkOutputFolder } from './output-dir.js';
import { buildProgram, EXIT } from './program.js';
import { writeReport } from './report/write.js';
import { runShipCheck } from './runner.js';
import { writeStepSummary } from './step-summary.js';
import { summaryLines } from './summary.js';

const print = (line = ''): void => void process.stdout.write(`${line}\n`);

async function run(urlArg: string, flags: Record<string, unknown>): Promise<number> {
  const config = loadConfig(urlArg, flags, process.env, readConfigFile(process.cwd()));
  // Without a key this stops here with a how-to (exit code 2), before anything is opened.
  const model = config.noAi ? undefined : chooseModel(process.env, config.model);
  const outDir = resolve(config.out);
  await checkOutputFolder(outDir, config.out);
  await confirmOwnership(config, { env: process.env, interactive: process.stdin.isTTY === true });

  print(`\nShipCheck is checking ${config.url}\n`);
  if (model) print(`  AI model: ${model.stagehandModel} (key from ${model.keySource})\n`);
  const result = await runShipCheck(
    config,
    { progress: (line) => print(`  ${line}`) },
    model ? { model } : {},
  );
  const { report } = result;
  let written: Awaited<ReturnType<typeof writeReport>>;
  try {
    written = await writeReport(outDir, report, result.screenshots, result.redact);
  } catch (error) {
    // The folder was writable at the start; if that changed, the result is still shown.
    for (const line of summaryLines(report, '(not written)', result.llm)) print(line);
    throw new ConfigError(
      `The check finished, but the report could not be saved in “${config.out}”` +
        ` (${(error as { code?: string }).code ?? 'unknown reason'}). The summary above is the result.`,
    );
  }
  for (const line of summaryLines(report, written.htmlPath, result.llm)) print(line);
  await writeStepSummary(report, process.env);
  await openReport(written.htmlPath, {
    env: process.env,
    interactive: process.stdout.isTTY === true,
  });
  return exitCodeFor(report.counts, config.failOn);
}

// A ".env" file in the current folder may hold the AI key (never committed, see .env.example).
// Variables already set in the terminal win over the file.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // An unreadable .env is ignored; a missing key is explained later in plain words.
  }
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

// Work cut off at the time limit (a model call still waiting for an answer, a page that keeps
// the browser busy) may still hold the process open after the report is written (audit A-04).
// The timer does not itself keep the process alive: a run that ends normally exits at once.
setTimeout(() => process.exit(exitCode), 5000).unref();
