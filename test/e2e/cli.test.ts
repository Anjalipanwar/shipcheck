import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * The real command, started the way a user starts it (M7, SPEC §5.1): flags, exit codes, the
 * printed summary, the settings file. Each run starts in an empty temporary folder with an
 * environment that holds no AI key, so no run here can ever use a real key: the repo's own
 * ".env" is out of reach, and every run that tests something uses --no-ai.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const TSX = pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href;
const SOURCE_CLI = ['--import', TSX, join(root, 'src/cli.ts')];

interface Outcome {
  code: number | null;
  output: string;
}

function start(
  entry: string[],
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<Outcome> {
  const child = spawn(process.execPath, [...entry, ...args], {
    cwd,
    // Only what is needed to start Node and find the browser; CI is set per test, never inherited.
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      // Where the browser is installed, if the machine keeps it somewhere special.
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
        : {}),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'], // no terminal: nobody can answer a question
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, output })));
}

const NO_STACK_TRACE = /\bat .*:\d+:\d+/;

describe('the shipcheck command', () => {
  let app: FixtureServer;
  let dir: string;
  beforeAll(async () => {
    app = await startFixtureServer();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipcheck-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const cli = (args: string[], env: Record<string, string> = {}) =>
    start(SOURCE_CLI, args, dir, env);
  const quick = ['--no-ai', '--skip-mobile'];

  it('checks the app, prints verdict, top problems and the report path; exit code 1 because of a Blocker', async () => {
    const { code, output } = await cli([app.url, ...quick, '--yes']);
    expect(code).toBe(1);
    expect(output).toContain(`ShipCheck is checking ${app.url}`);
    expect(output).toMatch(/Opening your app… ✓/); // live progress, one line per step
    expect(output).toMatch(/Verdict: .+/);
    expect(output).toMatch(/\d+ Blockers? · \d+ Major · \d+ Minor · \d+ Info/);
    const top = output.slice(output.indexOf('Fix these first:')).split('\n').slice(1, 5);
    expect(top[0]).toMatch(/^ {2}1\. \[blocker\] /);
    expect(top.filter((line) => /^ {2}\d\. \[/.test(line))).toHaveLength(3); // top 3, no more
    const report = /Report: (.+report\.html)/.exec(output)?.[1] ?? '';
    expect(report).toContain(join('shipcheck-report', 'report.html')); // the default folder
    expect(existsSync(report)).toBe(true);
    expect(existsSync(join(dir, 'shipcheck-report', 'report.json'))).toBe(true);
    expect(existsSync(join(dir, 'shipcheck-report', 'report.md'))).toBe(true);
    expect(output).not.toMatch(NO_STACK_TRACE);
  });

  it('--fail-on none → exit code 0 for the same app; --out chooses the folder', async () => {
    const { code, output } = await cli([
      app.url,
      ...quick,
      '--yes',
      '--fail-on',
      'none',
      '--out',
      'qa/out',
    ]);
    expect(code).toBe(0);
    expect(output).toContain('Fix these first:'); // the problems are still shown
    expect(existsSync(join(dir, 'qa', 'out', 'report.html'))).toBe(true);
    expect(existsSync(join(dir, 'shipcheck-report'))).toBe(false);
  });

  it('--flows and --max-minutes are accepted (that they are used is proven in ai-flows and safety tests)', async () => {
    const { code, output } = await cli([
      app.url,
      ...quick,
      '--yes',
      '--flows',
      'landing',
      '--max-minutes',
      '2',
    ]);
    expect(code).toBe(1);
    expect(output).not.toMatch(NO_STACK_TRACE);
  });

  it('an app that does not open is a Blocker (exit code 1), so a CI job cannot go green on a dead app', async () => {
    const { code, output } = await cli(['http://127.0.0.1:9', ...quick, '--yes']);
    expect(code).toBe(1);
    expect(output).toContain('Opening your app… it did not load');
    expect(output).toContain('[blocker] Your app’s home page does not load');
  });

  it('an address that forwards to another website: never "Home page opens"; plain message with the address to use, exit code 2, no report, the other site never contacted (audit A-01)', async () => {
    const outside = await startFixtureServer();
    try {
      const forwarding = `${app.url}/__redirect?to=${encodeURIComponent(`${outside.url}/landed-home`)}`;
      const { code, output } = await cli([forwarding, ...quick, '--yes']);
      expect(code).toBe(2);
      expect(output).not.toContain('Opening your app… ✓');
      expect(output).toContain('forwards visitors to another website');
      expect(output).toContain(`${outside.url}/landed-home`);
      expect(output).not.toMatch(NO_STACK_TRACE);
      expect(existsSync(join(dir, 'shipcheck-report'))).toBe(false);
      expect(outside.requests.filter((r) => r.includes('/landed-home'))).toEqual([]);
    } finally {
      await outside.close();
    }
  });

  describe('exit code 2: ShipCheck itself could not run — nothing is opened, no stack trace', () => {
    const nothingStarted = (output: string) => {
      expect(output).not.toContain('ShipCheck is checking');
      expect(existsSync(join(dir, 'shipcheck-report'))).toBe(false);
      expect(output).not.toMatch(NO_STACK_TRACE);
    };

    it('no address', async () => {
      const { code, output } = await cli([...quick, '--yes']);
      expect(code).toBe(2);
      expect(output).toContain('--help');
      nothingStarted(output);
    });

    it('an address that is not one', async () => {
      const { code, output } = await cli(['not a web address', ...quick, '--yes']);
      expect(code).toBe(2);
      expect(output).toContain('is not a valid web address');
      nothingStarted(output);
    });

    it('a flag that does not exist', async () => {
      const { code, output } = await cli([app.url, ...quick, '--yes', '--turbo']);
      expect(code).toBe(2);
      expect(output).toContain('--turbo');
      nothingStarted(output);
    });

    it.each([
      [['--flows', 'landing,checkout'], 'Unknown flow “checkout”'],
      [['--max-minutes', 'lots'], '--max-minutes must be a number'],
      [['--fail-on', 'everything'], 'everything'],
    ])('a wrong value: %j', async (flags, message) => {
      const { code, output } = await cli([app.url, ...quick, '--yes', ...flags]);
      expect(code).toBe(2);
      expect(output).toContain(message);
      nothingStarted(output);
    });

    it('no AI key: a how-to in plain words, before anything is opened', async () => {
      const { code, output } = await cli([app.url, '--yes']);
      expect(code).toBe(2);
      expect(output).toMatch(/GEMINI_API_KEY/);
      expect(output).toMatch(/--no-ai/); // the way to run without a key is named
      nothingStarted(output);
    });

    it('not in a terminal, no --yes, not in CI: asks for the confirmation instead of testing', async () => {
      const { code, output } = await cli([app.url, ...quick]);
      expect(code).toBe(2);
      expect(output).toContain('add --yes if you own the app or have permission to test it');
      nothingStarted(output);
    });
  });

  it('test browser not installed yet (first run): a plain how-to with the install command, exit code 2', async () => {
    const empty = join(dir, 'no-browsers-here');
    const { code, output } = await cli([app.url, ...quick, '--yes'], {
      PLAYWRIGHT_BROWSERS_PATH: empty,
    });
    expect(code).toBe(2);
    expect(output).toContain('ShipCheck needs its test browser (Chromium)');
    // The exact version ShipCheck was built with, so the downloaded browser fits.
    expect(output).toMatch(/npx playwright@\d+\.\d+\.\d+ install chromium/);
    expect(output).not.toContain('unexpected problem');
    expect(output).not.toMatch(NO_STACK_TRACE);
    expect(existsSync(join(dir, 'shipcheck-report'))).toBe(false);
  });

  it('in CI (CI=true) the ownership question is skipped', async () => {
    const { code, output } = await cli([app.url, ...quick, '--flows', 'landing'], { CI: 'true' });
    expect(code).toBe(1);
    expect(output).toContain(`ShipCheck is checking ${app.url}`);
  });

  describe('shipcheck.config.json in the current folder', () => {
    const settings = (content: unknown) =>
      writeFileSync(join(dir, 'shipcheck.config.json'), JSON.stringify(content));

    it('its settings are used; a flag typed on the command line wins', async () => {
      settings({
        noAi: true,
        skipMobile: true,
        failOn: 'none',
        out: 'from-file',
        flows: 'landing',
      });
      const fromFile = await cli([app.url, '--yes']);
      expect(fromFile.code).toBe(0); // failOn: none
      expect(existsSync(join(dir, 'from-file', 'report.html'))).toBe(true);
      expect(fromFile.output).toContain('Automatic checks only'); // noAi: no key was needed

      const overridden = await cli([app.url, '--yes', '--fail-on', 'blocker', '--out', 'typed']);
      expect(overridden.code).toBe(1);
      expect(existsSync(join(dir, 'typed', 'report.html'))).toBe(true);
    });

    it('a password in the file stops the run (exit code 2) and is not repeated', async () => {
      settings({ noAi: true, email: 'demo@example.com', password: 'CorrectHorse1!' });
      const { code, output } = await cli([app.url, '--yes']);
      expect(code).toBe(2);
      expect(output).toContain('SHIPCHECK_PASSWORD');
      expect(output).not.toContain('CorrectHorse1!');
      expect(output).not.toContain('ShipCheck is checking');
    });

    it('a typo in the file stops the run and names the setting', async () => {
      settings({ noAi: true, skipMobil: true });
      const { code, output } = await cli([app.url, '--yes']);
      expect(code).toBe(2);
      expect(output).toContain('“skipMobil”');
    });
  });

  it('a password given on the command line or in the environment is in no output and no file', async () => {
    const secret = 'Sup3r-Secret-Horse-77';
    for (const [flags, env] of [
      [['--email', 'demo@example.com', '--password', secret], {}],
      [[], { SHIPCHECK_EMAIL: 'demo@example.com', SHIPCHECK_PASSWORD: secret }],
    ] as const) {
      const { output } = await cli([app.url, ...quick, '--yes', '--out', 'pw', ...flags], env);
      expect(output).toContain('Report: ');
      expect(output).not.toContain(secret);
      for (const file of ['report.html', 'report.json', 'report.md']) {
        expect(readFileSync(join(dir, 'pw', file), 'utf8')).not.toContain(secret);
      }
    }
  });

  it('on GitHub Actions (GITHUB_STEP_SUMMARY set) the short report is added to the run’s summary page', async () => {
    const summary = join(dir, 'step-summary.md');
    writeFileSync(summary, 'earlier step\n'); // other steps' text must stay
    const { code } = await cli([app.url, ...quick], {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_STEP_SUMMARY: summary,
      SHIPCHECK_ARTIFACT_NAME: 'qa-report',
      SHIPCHECK_EMAIL: 'demo@example.com',
      SHIPCHECK_PASSWORD: 'Sup3r-Secret-Horse-77',
    });
    expect(code).toBe(1);
    const text = readFileSync(summary, 'utf8');
    expect(text.startsWith('earlier step\n')).toBe(true);
    expect(text).toContain('## ShipCheck report');
    expect(text).toMatch(/\| Severity \| Issue \| Area \| Device \|/);
    expect(text).toMatch(/\| Blocker \| .+ \|/);
    expect(text).toContain('`qa-report` artifact'); // the name the action uploads it under
    expect(text).not.toContain('Sup3r-Secret-Horse-77');
  });

  it('a summary file that cannot be written does not fail the run', async () => {
    const { code, output } = await cli([app.url, ...quick], {
      CI: 'true',
      GITHUB_STEP_SUMMARY: join(dir, 'no-such-folder', 'summary.md'),
    });
    expect(code).toBe(1);
    expect(output).toContain('Report: ');
    expect(output).not.toMatch(NO_STACK_TRACE);
  });

  it('--help lists every flag and the settings file; --version prints the version; both exit 0', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    for (const flag of [
      '--email',
      '--password',
      '--goal',
      '--out',
      '--model',
      '--skip-mobile',
      '--flows',
      '--max-minutes',
      '--fail-on',
      '--headed',
      '--yes',
      '--no-ai',
    ]) {
      expect(help.output).toContain(flag);
    }
    expect(help.output).toContain('shipcheck.config.json');
    const version = await cli(['--version']);
    expect(version.code).toBe(0);
    expect(version.output.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the built package (node dist/cli.js after npm run build)', () => {
  let app: FixtureServer;
  let dir: string;
  beforeAll(async () => {
    // dist/ was built once before all browser tests (test/helpers/build-once.ts).
    app = await startFixtureServer();
    dir = mkdtempSync(join(tmpdir(), 'shipcheck-dist-'));
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('test browser not installed: the built package shows the how-to with the install command too', async () => {
    const { code, output } = await start(
      [join(root, 'dist/cli.js')],
      [app.url, '--no-ai', '--skip-mobile', '--yes', '--out', 'never-written'],
      dir,
      { PLAYWRIGHT_BROWSERS_PATH: join(dir, 'no-browsers-here') },
    );
    expect(code).toBe(2);
    expect(output).toMatch(/npx playwright@\d+\.\d+\.\d+ install chromium/);
    expect(existsSync(join(dir, 'never-written'))).toBe(false);
  });

  it('runs a check and writes the report', async () => {
    const { code, output } = await start(
      [join(root, 'dist/cli.js')],
      [app.url, '--no-ai', '--skip-mobile', '--yes'],
      dir,
    );
    expect(code).toBe(1);
    expect(output).toMatch(/Verdict: .+/);
    expect(existsSync(join(dir, 'shipcheck-report', 'report.html'))).toBe(true);
    expect(output).not.toMatch(NO_STACK_TRACE);
  });
});
