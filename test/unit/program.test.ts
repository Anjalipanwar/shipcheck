import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type RunHandler } from '../../src/program.js';
import { VERSION } from '../../src/version.js';

/** Builds the CLI so it throws instead of exiting, and captures what it prints. */
function setup() {
  const run = vi.fn<RunHandler>(async () => undefined);
  let out = '';
  let err = '';
  const program = buildProgram(run)
    .exitOverride()
    .configureOutput({
      writeOut: (s) => (out += s),
      writeErr: (s) => (err += s),
    });
  return { program, run, output: () => ({ out, err }) };
}

describe('CLI definition', () => {
  it('documents every flag from SPEC §5.1 in --help', () => {
    const help = setup().program.helpInformation();
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
      '--no-ai',
      '--headed',
      '--yes',
    ]) {
      expect(help).toContain(flag);
    }
  });

  it('prints the package version', async () => {
    const { program, output } = setup();
    await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
      exitCode: 0,
    });
    expect(output().out.trim()).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('passes the URL and default flag values to the run handler', async () => {
    const { program, run } = setup();
    await program.parseAsync(['https://example.test'], { from: 'user' });
    expect(run).toHaveBeenCalledWith(
      'https://example.test',
      expect.objectContaining({
        out: './shipcheck-report',
        failOn: 'blocker',
        maxMinutes: '10',
        skipMobile: false,
        headed: false,
        yes: false,
      }),
    );
  });

  it('rejects a missing URL without calling the run handler', async () => {
    const { program, run, output } = setup();
    await expect(program.parseAsync([], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.missingArgument',
    });
    expect(run).not.toHaveBeenCalled();
    expect(output().err).toContain('url');
  });

  it('rejects an unknown --fail-on level', async () => {
    const { program, run } = setup();
    await expect(
      program.parseAsync(['https://example.test', '--fail-on', 'everything'], { from: 'user' }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
