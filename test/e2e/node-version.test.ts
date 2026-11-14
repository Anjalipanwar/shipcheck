import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Runs the real entry file with Node pretending to be another version. */
async function runWithNodeVersion(version: string, args: string[]) {
  const pretend = `Object.defineProperty(process.versions, 'node', { value: '${version}' });`;
  const child = spawn(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(pretend)}`,
      '--import',
      'tsx',
      join(root, 'src/cli.ts'),
      ...args,
    ],
    { cwd: root },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise((resolve) => child.on('exit', resolve));
  return { code, output };
}

describe('startup Node.js version check', () => {
  it('an old Node gets the how-to and exit code 2, not a crash', async () => {
    const { code, output } = await runWithNodeVersion('20.17.0', ['https://example.com', '--yes']);
    expect(code).toBe(2);
    expect(output).toContain('ShipCheck needs Node 22.12 or newer — you have Node 20.17.0.');
    expect(output).toContain('https://nodejs.org');
    expect(output).not.toContain('ShipCheck is checking'); // nothing was started
    expect(output).not.toMatch(/\bat .*:\d+:\d+/); // no stack trace
  });

  it('a supported Node runs normally', async () => {
    const { code, output } = await runWithNodeVersion('22.12.0', ['--version']);
    expect(code).toBe(0);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
