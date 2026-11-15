import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { askInTerminal, confirmOwnership } from '../../src/confirm.js';
import { ConfigError } from '../../src/config.js';
import { exitCodeFor } from '../../src/exit-code.js';
import { openReport, shouldOpenReport } from '../../src/open-report.js';

describe('exit code (SPEC §5.1)', () => {
  it.each([
    // blocker, major, --fail-on, expected
    [0, 0, 'blocker', 0],
    [0, 3, 'blocker', 0],
    [1, 0, 'blocker', 1],
    [0, 0, 'major', 0],
    [0, 1, 'major', 1],
    [1, 0, 'major', 1],
    [0, 0, 'none', 0],
    [2, 5, 'none', 0],
  ] as const)('%i Blocker, %i Major, --fail-on %s → %i', (blocker, major, failOn, expected) => {
    expect(exitCodeFor({ blocker, major }, failOn)).toBe(expected);
  });
});

describe('opening the report when the run is done', () => {
  it.each([
    [{ env: {}, interactive: true }, true],
    [{ env: { CI: 'true' }, interactive: true }, false],
    [{ env: { CI: '1' }, interactive: true }, false],
    [{ env: { GITHUB_ACTIONS: 'true' }, interactive: true }, false],
    [{ env: { CI: 'false' }, interactive: true }, true],
    [{ env: {}, interactive: false }, false], // output piped or redirected: nobody is watching
  ])('%j → %s', (situation, expected) => {
    expect(shouldOpenReport(situation)).toBe(expected);
  });

  it('opens the report file for a person at a terminal', async () => {
    const opener = vi.fn(() => Promise.resolve());
    expect(await openReport('/tmp/r/report.html', { env: {}, interactive: true }, opener)).toBe(
      true,
    );
    expect(opener).toHaveBeenCalledWith('/tmp/r/report.html');
  });

  it('never opens anything in CI', async () => {
    const opener = vi.fn(() => Promise.resolve());
    expect(
      await openReport('/tmp/r/report.html', { env: { CI: 'true' }, interactive: true }, opener),
    ).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it('a browser that cannot be opened is not an error', async () => {
    const opener = vi.fn(() => Promise.reject(new Error('no browser here')));
    expect(await openReport('/tmp/r/report.html', { env: {}, interactive: true }, opener)).toBe(
      false,
    );
  });
});

describe('ownership confirmation (SPEC §7.7)', () => {
  const app = { url: 'https://example.test/', yes: false };
  const terminal = (answer: string | Error) => ({
    env: {},
    interactive: true,
    ask: vi.fn<(question: string) => Promise<string>>(() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    ),
  });

  it.each(['y', 'Y', 'yes', ' Yes '])('“%s” continues', async (answer) => {
    const situation = terminal(answer);
    await expect(confirmOwnership(app, situation)).resolves.toBeUndefined();
    expect(situation.ask).toHaveBeenCalledOnce();
    expect(situation.ask.mock.calls[0]?.[0]).toContain(
      'Only test apps you own or have permission to test. Continue? (y/N)',
    );
    expect(situation.ask.mock.calls[0]?.[0]).toContain('https://example.test/');
  });

  it.each(['', 'n', 'no', 'maybe', 'yess', 'y?'])(
    '“%s” stops before anything is tested',
    async (answer) => {
      await expect(confirmOwnership(app, terminal(answer))).rejects.toThrow(
        new ConfigError('Stopped. Nothing was tested.'),
      );
    },
  );

  it('closing the question without an answer (Ctrl+D) stops too, in plain words', async () => {
    await expect(confirmOwnership(app, terminal(new Error('closed')))).rejects.toThrow(
      new ConfigError('Stopped. Nothing was tested.'),
    );
  });

  it('--yes and CI=true skip the question', async () => {
    const yes = terminal('n');
    await confirmOwnership({ ...app, yes: true }, yes);
    expect(yes.ask).not.toHaveBeenCalled();
    const ci = { ...terminal('n'), env: { CI: 'true' } };
    await confirmOwnership(app, ci);
    expect(ci.ask).not.toHaveBeenCalled();
  });

  it('nobody there to answer (not a terminal): refuses and names --yes, without asking', async () => {
    const situation = { ...terminal('y'), interactive: false };
    await expect(confirmOwnership(app, situation)).rejects.toThrow(/add --yes if you own the app/);
    expect(situation.ask).not.toHaveBeenCalled();
  });
});

describe('asking a question in the terminal', () => {
  it('returns the line that was typed', async () => {
    const input = new PassThrough();
    const answer = askInTerminal('Continue? ', input, new PassThrough());
    input.write('y\n');
    await expect(answer).resolves.toBe('y');
  });

  it('input closed before an answer (Ctrl+D): the question ends instead of hanging', async () => {
    const input = new PassThrough();
    const answer = askInTerminal('Continue? ', input, new PassThrough());
    input.end();
    await expect(answer).rejects.toThrow(/closed without an answer/);
  });
});
