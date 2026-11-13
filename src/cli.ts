#!/usr/bin/env node
import { CommanderError } from 'commander';
import { buildProgram, EXIT } from './program.js';

let exitCode: number = EXIT.passed;

// Milestone M0: the run itself arrives in later milestones (see docs/BUILD_PLAN.md).
const program = buildProgram(async () => {
  console.error('ShipCheck is not ready to run checks yet — this build only has the CLI skeleton.');
  exitCode = EXIT.shipcheckFailed;
}).exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    // --help and --version end with code 0; any usage mistake (missing URL, unknown flag)
    // counts as "ShipCheck itself could not run" = exit 2 (SPEC §5.1). Commander already
    // printed a friendly message.
    exitCode = error.exitCode === 0 ? EXIT.passed : EXIT.shipcheckFailed;
  } else {
    // No stack traces for users (SPEC §5.1).
    console.error('ShipCheck hit an unexpected problem and had to stop.');
    exitCode = EXIT.shipcheckFailed;
  }
}

process.exitCode = exitCode;
