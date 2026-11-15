import { createInterface } from 'node:readline/promises';
import { ConfigError, type Config } from './config.js';

export interface ConfirmSituation {
  env: Record<string, string | undefined>;
  /** A person can type an answer (the input is a terminal). */
  interactive: boolean;
  /** Asks the question and returns what was typed. Replaced in tests. */
  ask?: (question: string) => Promise<string>;
}

async function askInTerminal(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

/**
 * SPEC §7.7: ask once whether the user may test this app — unless --yes was given or we are
 * running in CI. Anything but a clear yes stops the run before the app is opened; so does
 * closing the question without an answer (Ctrl+C, Ctrl+D).
 */
export async function confirmOwnership(
  config: Pick<Config, 'url' | 'yes'>,
  { env, interactive, ask = askInTerminal }: ConfirmSituation,
): Promise<void> {
  if (config.yes || env.CI === 'true') return;
  if (!interactive) {
    throw new ConfigError(
      'ShipCheck needs you to confirm that you may test this app. Run it in a terminal, or add --yes if you own the app or have permission to test it.',
    );
  }
  // A question closed without an answer counts as "no".
  const answer = await ask(
    `ShipCheck will open ${config.url} and use it like a visitor.\nOnly test apps you own or have permission to test. Continue? (y/N) `,
  ).catch(() => '');
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new ConfigError('Stopped. Nothing was tested.');
  }
}
