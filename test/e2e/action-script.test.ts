import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRepoFile, runScripts } from '../helpers/action-file.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * GitHub Actions cannot run on a developer's machine, but the script inside the action can:
 * this runs the "Run ShipCheck" script of action.yml exactly as written, with the inputs given
 * the way GitHub gives them (environment variables), against the pretend app.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const script =
  runScripts(readRepoFile('action.yml')).find((s) => s.includes('SHIPCHECK_CLI')) ?? '';

describe('the action’s “Run ShipCheck” script', () => {
  let app: FixtureServer;
  let dir: string;
  beforeAll(async () => {
    const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
    expect(await new Promise((resolve) => build.on('exit', resolve))).toBe(0);
    app = await startFixtureServer();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipcheck-action-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function runAction(inputs: Record<string, string>) {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH
          ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
          : {}),
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_OUTPUT: join(dir, 'github-output.txt'),
        GITHUB_STEP_SUMMARY: join(dir, 'step-summary.md'),
        SHIPCHECK_CLI: join(root, 'dist/cli.js'),
        // What action.yml sets when an optional input is left out.
        INPUT_GOAL: '',
        INPUT_FLOWS: '',
        INPUT_SKIP_MOBILE: 'false',
        INPUT_NO_AI: 'false',
        INPUT_MODEL: '',
        INPUT_MAX_MINUTES: '',
        INPUT_FAIL_ON: '',
        INPUT_OUT: 'shipcheck-report',
        GEMINI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        SHIPCHECK_EMAIL: '',
        SHIPCHECK_PASSWORD: '',
        SHIPCHECK_ARTIFACT_NAME: 'shipcheck-report',
        ...inputs,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    const outputsFile = join(dir, 'github-output.txt');
    const outputs = Object.fromEntries(
      (existsSync(outputsFile) ? readFileSync(outputsFile, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    return { code, output, outputs };
  }

  it('found the script in action.yml', () => {
    expect(script).toContain('node "$SHIPCHECK_CLI"');
  });

  it('automatic checks, fail-on none: succeeds, writes the report, the summary and the outputs', async () => {
    const { code, outputs } = await runAction({
      INPUT_URL: app.url,
      INPUT_NO_AI: 'true',
      INPUT_SKIP_MOBILE: 'true',
      INPUT_FAIL_ON: 'none',
      INPUT_OUT: 'qa/report',
      SHIPCHECK_ARTIFACT_NAME: 'my-report',
    });
    expect(code).toBe(0);
    expect(outputs).toEqual({
      verdict: 'checks-found-issues',
      'exit-code': '0',
      'report-dir': 'qa/report',
    });
    expect(existsSync(join(dir, 'qa/report/report.html'))).toBe(true);
    const summary = readFileSync(join(dir, 'step-summary.md'), 'utf8');
    expect(summary).toContain('## ShipCheck report');
    expect(summary).toContain('`my-report` artifact');
  });

  it('default fail-on: a Blocker fails the step with exit code 1, outputs and report are still there', async () => {
    const { code, outputs } = await runAction({
      INPUT_URL: app.url,
      INPUT_NO_AI: 'true',
      INPUT_SKIP_MOBILE: 'true',
    });
    expect(code).toBe(1);
    expect(outputs['exit-code']).toBe('1');
    expect(outputs.verdict).toBe('checks-found-issues');
    expect(existsSync(join(dir, 'shipcheck-report/report.html'))).toBe(true);
  });

  it('no key and no-ai not set: exit code 2, empty verdict, nothing written', async () => {
    const { code, output, outputs } = await runAction({ INPUT_URL: app.url });
    expect(code).toBe(2);
    expect(outputs).toEqual({ verdict: '', 'exit-code': '2', 'report-dir': 'shipcheck-report' });
    expect(output).toContain('GEMINI_API_KEY');
    expect(existsSync(join(dir, 'shipcheck-report'))).toBe(false);
  });

  it('input values are data, never commands: quotes, $( ) and ; in an input run nothing', async () => {
    const { code, output } = await runAction({
      INPUT_URL: app.url,
      INPUT_NO_AI: 'true',
      INPUT_SKIP_MOBILE: 'true',
      INPUT_FLOWS: 'landing',
      INPUT_FAIL_ON: 'none',
      INPUT_GOAL: '"; touch pwned-1; echo "$(touch pwned-2)`touch pwned-3`',
      INPUT_OUT: 'out $(touch pwned-4)',
    });
    expect(code).toBe(0);
    expect(output).not.toMatch(/\bat .*:\d+:\d+/);
    expect(readdirSync(dir).filter((name) => name.startsWith('pwned'))).toEqual([]);
    expect(existsSync(join(dir, 'out $(touch pwned-4)', 'report.html'))).toBe(true);
  });

  it('the test account’s password is passed on by environment and appears in no output', async () => {
    const secret = 'Sup3r-Secret-Horse-77';
    const { output } = await runAction({
      INPUT_URL: app.url,
      INPUT_NO_AI: 'true',
      INPUT_SKIP_MOBILE: 'true',
      SHIPCHECK_EMAIL: 'demo@example.com',
      SHIPCHECK_PASSWORD: secret,
    });
    expect(output).not.toContain(secret);
    for (const file of ['github-output.txt', 'step-summary.md', 'shipcheck-report/report.json']) {
      expect(readFileSync(join(dir, file), 'utf8')).not.toContain(secret);
    }
  });
});
