import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILE, readConfigFile } from '../../src/config.js';
import { buildProgram } from '../../src/program.js';
import { ADVICE, AI_KEY_HELP, fullCheckCommand } from '../../src/report/present.js';
import { REPO_URL } from '../../src/version.js';
import { actionInputs, readRepoFile, withOf } from '../helpers/action-file.js';

/**
 * Every command and link shown in a report must work (owner decision 2026-11-15, BUILD_PLAN
 * M9): the README has the sections reports point to, and every flag a report or the README
 * names exists in the command.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const readme = readRepoFile('README.md');

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces become hyphens. */
const anchorOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const headings = (markdown: string): string[] =>
  markdown
    .replace(/```[\s\S]*?```/g, '') // a "#" inside a code block is not a heading
    .split('\n')
    .flatMap((line) => {
      const text = /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1];
      return text ? [anchorOf(text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))] : [];
    });

const flagsIn = (text: string): string[] => [
  ...new Set([...text.matchAll(/(?<![\w-])--[a-z][a-z-]+/g)].map((match) => match[0])),
];

const commandFlags = buildProgram(() => Promise.resolve()).options.flatMap((option) =>
  option.long ? [option.long] : [],
);

describe('the README has what reports point to', () => {
  const anchors = headings(readme);

  it('computes anchors the way GitHub does', () => {
    expect(anchorOf('Get a free AI key')).toBe('get-a-free-ai-key');
    expect(anchorOf('Limits — please read')).toBe('limits--please-read');
    expect(anchorOf('Quickstart (about 5 minutes)')).toBe('quickstart-about-5-minutes');
  });

  it('“How to get a free AI key” in a report leads to a README section that exists', () => {
    const [page, anchor] = AI_KEY_HELP.url.split('#');
    expect(page).toBe(REPO_URL);
    expect(anchor).toBeTruthy();
    expect(anchors).toContain(anchor);
    // …and that section really says how: the key page and the variable to set.
    const section = readme.slice(readme.indexOf('## Get a free AI key'));
    expect(section.slice(0, section.indexOf('\n## ', 5))).toMatch(
      /aistudio\.google\.com\/apikey[\s\S]*GEMINI_API_KEY=/,
    );
  });

  it('“Add a test account (see the README)” has its section, with both ways to give the account', () => {
    expect(ADVICE.account).toContain('see the README');
    expect(anchors).toContain('add-a-test-account');
    const section = readme.slice(readme.indexOf('## Add a test account'));
    const text = section.slice(0, section.indexOf('\n## ', 5));
    for (const needed of ['--email', '--password', 'SHIPCHECK_EMAIL', 'SHIPCHECK_PASSWORD']) {
      expect(text).toContain(needed);
    }
  });

  it('every link inside the README leads somewhere: sections and files', () => {
    const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? '');
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      if (link.startsWith('#')) expect(anchors, `section ${link}`).toContain(link.slice(1));
      else if (!/^https?:/.test(link))
        expect(existsSync(join(root, link.split('#')[0] ?? '')), `file ${link}`).toBe(true);
    }
  });

  it('the project page links to README sections that exist, and to its own sample report', () => {
    const page = readRepoFile('docs-site/index.html');
    const linked = [...page.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(linked).toContain('sample-report.html');
    expect(existsSync(join(root, 'docs-site/sample-report.html'))).toBe(true);
    for (const link of linked.filter((href) => href.startsWith(`${REPO_URL}#`))) {
      expect(anchors, link).toContain(link.split('#')[1]);
    }
    expect(linked.some((href) => href.startsWith(`${REPO_URL}#`))).toBe(true);
  });

  it.each(['CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md'])(
    'links to files in %s lead somewhere',
    (file) => {
      const text = readRepoFile(file);
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const link = match[1] ?? '';
        if (!/^https?:|^#/.test(link))
          expect(existsSync(join(root, dirname(file), link)), `file ${link}`).toBe(true);
      }
    },
  );
});

describe('every flag that a report, a message or the README names exists', () => {
  it('in the advice shown for “Not tested” areas', () => {
    const named = flagsIn(Object.values(ADVICE).join('\n'));
    expect(named).toEqual(expect.arrayContaining(['--flows', '--max-minutes', '--goal']));
    for (const flag of named) expect(commandFlags, flag).toContain(flag);
  });

  it('in every message ShipCheck can write (flows, runner, report texts, AI key help)', () => {
    const files = [
      ...readdirSync(join(root, 'src/flows')).map((name) => `src/flows/${name}`),
      'src/runner.ts',
      'src/coverage.ts',
      'src/report/present.ts',
      'src/ai/models.ts',
      'src/confirm.ts',
      'src/config.ts',
    ];
    const named = flagsIn(files.map((file) => readRepoFile(file)).join('\n'));
    expect(named).toEqual(expect.arrayContaining(['--email', '--password', '--goal', '--no-ai']));
    for (const flag of named) expect(commandFlags, flag).toContain(flag);
  });

  it('in the README — and the README’s options table lists every flag of the command', () => {
    const named = flagsIn(readme);
    for (const flag of named) expect(commandFlags, flag).toContain(flag);
    const table = readme.slice(readme.indexOf('## Options'), readme.indexOf('**Settings file.**'));
    for (const flag of commandFlags.filter((flag) => flag !== '--version')) {
      expect(table, `${flag} in the options table`).toContain(flag);
    }
  });

  it('the command printed in reports is the one the README uses', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { name: string };
    expect(fullCheckCommand('https://myapp.lovable.app')).toBe(
      `npx ${pkg.name} https://myapp.lovable.app`,
    );
    expect(readme).toContain(`npx ${pkg.name} https://myapp.lovable.app`);
  });
});

describe('the README’s examples are real', () => {
  it('the settings-file example is accepted by ShipCheck', () => {
    const example = /```json\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'shipcheck-readme-'));
    try {
      writeFileSync(join(dir, CONFIG_FILE), example);
      expect(Object.keys(readConfigFile(dir)).length).toBeGreaterThanOrEqual(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the GitHub Action example uses the same action and inputs as examples/github-workflow.yml', () => {
    const example = readRepoFile('examples/github-workflow.yml');
    const uses = /uses: (Anjalipanwar\/shipcheck@\S+)/.exec(example)?.[1] ?? '';
    expect(readme).toContain(`uses: ${uses}`);
    const inReadme = withOf(readme, uses);
    expect(Object.keys(inReadme)).toEqual(Object.keys(withOf(example, uses)));
    for (const name of Object.keys(inReadme)) {
      expect(actionInputs(readRepoFile('action.yml'))).toContain(name);
    }
  });

  it('the sample report exists, is about the pretend app, and shows no unmasked secret', () => {
    for (const file of ['examples/reports/buggy-app.md', 'examples/reports/buggy-app.html']) {
      const text = readFileSync(join(root, file), 'utf8');
      expect(text).toContain('ShipCheck');
      expect(text).toContain('http://127.0.0.1:4173/');
      expect(text).not.toMatch(/sk_live_[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/\/Users\/|\/home\//);
    }
  });
});
