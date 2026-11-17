import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * Audit A-04: --max-minutes is a hard stop. A page that keeps the browser busy for good used to
 * hang the run with no report at all. The real command is started, as a user starts it.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const TSX = pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href;
const LIMIT_S = 60;
/** Closing the browser and writing the report after the limit. */
const GRACE_S = 25;
/** The test gives up (and fails) here, so a hang cannot block the test run. */
const KILL_S = 180;

let app: FixtureServer;
let dir: string;
beforeAll(async () => {
  app = await startFixtureServer();
  dir = mkdtempSync(join(tmpdir(), 'shipcheck-time-'));
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await app.close();
});

describe('the time limit (audit A-04)', () => {
  it(
    'a page that keeps the browser busy: the run stops at --max-minutes and still writes a partial report',
    async () => {
      const started = Date.now();
      const child = spawn(
        process.execPath,
        [
          '--import',
          TSX,
          join(root, 'src/cli.ts'),
          `${app.url}/busy.html`,
          '--no-ai',
          '--skip-mobile',
          '--yes',
          '--max-minutes',
          '1',
        ],
        {
          cwd: dir,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            ...(process.env.PLAYWRIGHT_BROWSERS_PATH
              ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
              : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      const killer = setTimeout(() => child.kill('SIGKILL'), KILL_S * 1000);
      const code = await new Promise<number | null>((resolve) =>
        child.on('exit', (exitCode) => resolve(exitCode)),
      );
      clearTimeout(killer);
      const seconds = (Date.now() - started) / 1000;

      expect(seconds, `the run took ${Math.round(seconds)} s:\n${output}`).toBeLessThan(
        LIMIT_S + GRACE_S,
      );
      expect(code).toBe(3); // stopped by the time limit, nothing at the --fail-on level
      expect(output).toMatch(/time limit/i);
      expect(output).not.toContain('unexpected problem');
      const reportFile = join(dir, 'shipcheck-report', 'report.json');
      expect(existsSync(reportFile)).toBe(true);
      const report = JSON.parse(readFileSync(reportFile, 'utf8')) as {
        meta: { partial: boolean; stoppedBy?: string };
        notTested: string[];
        findings: { rule: string }[];
      };
      expect(report.meta.partial).toBe(true);
      expect(report.meta.stoppedBy).toBe('time-limit');
      expect(report.notTested.join('\n')).toMatch(/time limit of 1 minute/);
      // Running out of time is not the app's fault: no "home page does not load".
      expect(report.findings.map((f) => f.rule)).not.toContain('landing/not-loading');
    },
    (KILL_S + 30) * 1000,
  );
});
