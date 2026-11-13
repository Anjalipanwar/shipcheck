import { Command, Option } from 'commander';
import { FAIL_ON_LEVELS, FLOW_NAMES } from './config.js';
import { VERSION } from './version.js';

/** Exit codes from SPEC §5.1. */
export const EXIT = { passed: 0, issuesFound: 1, shipcheckFailed: 2 } as const;

export type RunHandler = (url: string, flags: Record<string, unknown>) => Promise<void>;

/**
 * Builds the command-line definition (flags per SPEC §5.1).
 * Kept free of side effects so tests can build and inspect it without running anything.
 */
export function buildProgram(run: RunHandler): Command {
  return new Command()
    .name('shipcheck')
    .description(
      "A QA engineer's pre-launch checkup for your vibe-coded app.\n" +
        'Only test apps you own or have permission to test.',
    )
    .version(VERSION, '-v, --version', 'print the ShipCheck version')
    .argument('<url>', 'address of the app to check, e.g. https://myapp.lovable.app')
    .option('--email <email>', 'test account email for the login flow (or env SHIPCHECK_EMAIL)')
    .option('--password <password>', 'test account password (or env SHIPCHECK_PASSWORD)')
    .option('--goal <text>', 'the main task in plain English, e.g. "book a 30-minute slot"')
    .option('--out <dir>', 'output directory', './shipcheck-report')
    .option('--model <id>', 'AI model id (default: chosen from the AI key you have set)')
    .option('--skip-mobile', 'skip the phone-sized pass', false)
    .option('--flows <list>', `comma-separated subset of: ${FLOW_NAMES.join(',')}`)
    .option('--max-minutes <n>', 'hard time budget in minutes', '10')
    .addOption(
      new Option('--fail-on <level>', 'exit non-zero when issues at this level are found')
        .choices(FAIL_ON_LEVELS)
        .default('blocker'),
    )
    .option('--no-ai', 'run only the automatic checks that need no AI key')
    .option('--headed', 'show the browser while testing (debugging)', false)
    .option('--yes', 'skip the "do you own this app?" confirmation', false)
    .showHelpAfterError('(run "shipcheck --help" for usage)')
    .action((url: string, flags: Record<string, unknown>) => run(url, flags));
}
