import { createRequire } from 'node:module';
import { ConfigError } from '../config.js';

/**
 * ShipCheck drives its own copy of the Chromium browser, which has to be downloaded once
 * (SPEC §11). When it is not there, starting it fails with a technical message; this turns it
 * into a plain how-to. The command names the exact version ShipCheck was built with — a newer
 * one would download a browser that does not fit.
 */
export function installCommand(): string {
  let version = '';
  try {
    const pkg = createRequire(import.meta.url)('playwright/package.json') as { version?: string };
    version = pkg.version ? `@${pkg.version}` : '';
  } catch {
    // Without the version the command still works in most cases.
  }
  return `npx playwright${version} install chromium`;
}

export function isMissingBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|playwright install|browser has not been (found|installed)/i.test(
    message,
  );
}

export function missingBrowserError(): ConfigError {
  return new ConfigError(
    [
      'ShipCheck needs its test browser (Chromium), and it is not installed on this computer yet.',
      '',
      'Install it once with this command (a download of about 150 MB), then run ShipCheck again:',
      '',
      `  ${installCommand()}`,
      '',
      'On Linux, if the browser then fails to start, add  --with-deps  to that command.',
    ].join('\n'),
  );
}
