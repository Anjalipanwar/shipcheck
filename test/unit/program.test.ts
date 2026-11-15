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

  it('passes the URL to the run handler and sets no defaults itself (the settings file must be able to fill the gaps)', async () => {
    const { program, run } = setup();
    await program.parseAsync(['https://example.test'], { from: 'user' });
    expect(run).toHaveBeenCalledWith('https://example.test', { ai: true });
  });

  it('passes typed flags on as commander names them', async () => {
    const { program, run } = setup();
    await program.parseAsync(
      [
        'https://example.test',
        '--out',
        'x',
        '--fail-on',
        'major',
        '--max-minutes',
        '3',
        '--skip-mobile',
        '--headed',
        '--yes',
        '--no-ai',
        '--flows',
        'core',
      ],
      { from: 'user' },
    );
    expect(run).toHaveBeenCalledWith('https://example.test', {
      out: 'x',
      failOn: 'major',
      maxMinutes: '3',
      skipMobile: true,
      headed: true,
      yes: true,
      ai: false,
      flows: 'core',
    });
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
