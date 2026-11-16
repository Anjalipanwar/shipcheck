import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/program.js';
import { actionInputs, readRepoFile, runScripts, withOf } from '../helpers/action-file.js';

const action = readRepoFile('action.yml');
const example = readRepoFile('examples/github-workflow.yml');
const selftest = readRepoFile('.github/workflows/action-selftest.yml');

describe('action.yml (SPEC §5.2)', () => {
  const inputs = actionInputs(action);

  it('has the inputs the spec names, and one for every setting of the command', () => {
    expect(inputs).toEqual(
      expect.arrayContaining(['url', 'gemini-api-key', 'email', 'password']), // SPEC §5.2
    );
    // Every flag of the command can be set from a workflow — except the two that make no
    // sense there: --headed (no screen) and --yes (always given: a workflow cannot be asked).
    const flags = buildProgram(() => Promise.resolve())
      .options.map((option) => option.long?.replace(/^--/, '') ?? '')
      .filter((flag) => !['version', 'headed', 'yes'].includes(flag));
    expect(flags.length).toBeGreaterThanOrEqual(10);
    for (const flag of flags) expect(inputs, `input for --${flag}`).toContain(flag);
  });

  it('is a composite action that sets up Node, runs ShipCheck and uploads the report', () => {
    expect(action).toMatch(/using: 'composite'/);
    expect(action).toMatch(/uses: actions\/setup-node@v\d+/);
    expect(action).toMatch(/uses: actions\/upload-artifact@v\d+/);
    expect(action).toContain('npx playwright install --with-deps chromium');
    expect(action).toContain('if-no-files-found: ignore');
    // Order: run (never fails by itself) → upload the report → fail the job with the exit code.
    const order = ['id: run', 'name: Upload the report', 'name: Result', 'exit "$EXIT_CODE"'].map(
      (text) => action.indexOf(text),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // It leaves the caller's package cache alone and builds also under NODE_ENV=production.
    expect(action).toContain('package-manager-cache: false');
    expect(action).toContain('npm ci --include=dev');
  });

  it('never pastes anything from the workflow into a script (script injection)', () => {
    const scripts = runScripts(action);
    expect(scripts.length).toBe(3);
    for (const script of scripts) expect(script).not.toContain('${{');
  });

  it('hands the password and the AI keys to ShipCheck through the environment, not as arguments', () => {
    const run = runScripts(action).find((script) => script.includes('SHIPCHECK_CLI')) ?? '';
    expect(run).not.toMatch(/PASSWORD|API_KEY|EMAIL/);
    expect(run).not.toContain('--password');
    expect(action).toContain('SHIPCHECK_PASSWORD: ${{ inputs.password }}');
    expect(action).toContain('GEMINI_API_KEY: ${{ inputs.gemini-api-key }}');
  });

  it('every input it reads is one it declares', () => {
    const read = [...action.matchAll(/\$\{\{ inputs\.([a-z0-9-]+) \}\}/g)].map((m) => m[1]);
    expect(read.length).toBeGreaterThan(10);
    for (const name of read) expect(inputs).toContain(name);
    // …and every declared input is used.
    for (const name of inputs) expect(read, `input ${name} is never read`).toContain(name);
  });
});

describe('release workflows', () => {
  const workflow = (name: string): string => readRepoFile(`.github/workflows/${name}`);

  it('the release check calls the action the way users do (@v0), without an AI key, with inputs that exist', () => {
    const check = workflow('release-check.yml');
    const used = withOf(check, 'Anjalipanwar/shipcheck@v0');
    expect(Object.keys(used)).toEqual(['url', 'no-ai', 'fail-on']);
    for (const name of Object.keys(used)) expect(actionInputs(action)).toContain(name);
    expect(used.url).toContain('127.0.0.1'); // never a real website
    expect(check).not.toMatch(/secrets\./);
    expect(check).toMatch(/tags: \[v0\]/);
  });

  it('the project page workflow publishes docs-site/ and nothing else, with the two permissions Pages needs', () => {
    const pages = workflow('pages.yml');
    expect(pages).toMatch(/upload-pages-artifact@v\d+\n\s+with:\n\s+path: docs-site\//);
    expect(pages).toMatch(/pages: write/);
    expect(pages).toMatch(/id-token: write/);
    expect(pages).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});

describe('examples/github-workflow.yml (the file users copy)', () => {
  it('uses the published action with inputs that exist, and takes secrets from repository secrets', () => {
    // @v0: the tag that always points to the newest 0.x release.
    const used = withOf(example, 'Anjalipanwar/shipcheck@v0');
    expect(Object.keys(used)).toEqual(['url', 'gemini-api-key', 'email', 'password']);
    for (const name of Object.keys(used)) expect(actionInputs(action)).toContain(name);
    expect(used['gemini-api-key']).toContain('${{ secrets.GEMINI_API_KEY }}');
    expect(used.password).toContain('${{ secrets.SHIPCHECK_PASSWORD }}');
    // The commented-out options exist too.
    const optional = [...example.matchAll(/^\s+# ([a-z-]+): /gm)].map((m) => m[1] ?? '');
    expect(optional.length).toBeGreaterThanOrEqual(4);
    for (const name of optional) expect(actionInputs(action)).toContain(name);
  });

  it('can be started by hand, has the push trigger ready to switch on, and asks for no extra rights', () => {
    expect(example).toMatch(/^ {2}workflow_dispatch:/m);
    expect(example).toMatch(/^ {2}# push:/m);
    expect(example).toMatch(/permissions:\n {2}contents: read/);
    expect(example).toContain('Only test apps you own or have permission to test.');
  });
});

describe('.github/workflows/action-selftest.yml', () => {
  it('runs the action from this repository against the local pretend app, without any key', () => {
    expect(selftest.match(/uses: \.\/\n/g)).toHaveLength(3);
    expect(selftest).not.toMatch(/secrets\./);
    expect(selftest).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // no real website
    for (const script of runScripts(selftest)) expect(script).not.toContain('${{');
  });
});
