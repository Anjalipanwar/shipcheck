import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFinding, type Report } from '../../../src/report/schema.js';
import { redactDeep, writeReport } from '../../../src/report/write.js';
import { coverageFor } from './fixtures.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shipcheck-write-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const report = (overrides: Partial<Report> = {}): Report => ({
  meta: {
    url: 'https://example.com/',
    startedAt: '2026-11-13T00:00:00.000Z',
    durationMs: 1200,
    model: null,
    shipcheckVersion: '0.1.0',
    mode: 'full',
    partial: false,
    llmCalls: 12,
  },
  verdict: 'ready',
  counts: { blocker: 0, major: 0, minor: 0, info: 0 },
  findings: [],
  passed: ['Home page opens'],
  notTested: [],
  coverage: coverageFor('full'),
  actionLog: [],
  ...overrides,
});
const shot = (file: string) => ({
  file,
  label: 'x',
  device: 'desktop' as const,
  url: 'https://example.com/',
  data: Buffer.from('jpg'),
});
const same = (text: string) => text;

describe('writeReport', () => {
  it('writes report.json and the screenshots, creating folders as needed', async () => {
    const out = join(dir, 'nested', 'report');
    const written = await writeReport(
      out,
      report(),
      [shot('screenshots/01-desktop-home-page.jpg')],
      same,
    );
    expect(written.jsonPath).toBe(join(out, 'report.json'));
    expect(JSON.parse(await readFile(written.jsonPath, 'utf8'))).toMatchObject({
      verdict: 'ready',
      passed: ['Home page opens'],
    });
    expect(await readdir(join(out, 'screenshots'))).toEqual(['01-desktop-home-page.jpg']);
    expect((await readdir(out)).sort()).toEqual([
      'report.html',
      'report.json',
      'report.md',
      'screenshots',
    ]);
    expect(await readFile(written.htmlPath, 'utf8')).toContain('Ready to launch');
    expect(await readFile(written.markdownPath, 'utf8')).toContain('**Verdict: Ready to launch**');
  });

  it('scrubs protected values from the file as a last line of defence', async () => {
    const leaky = report({
      findings: [
        makeFinding({
          rule: 'test/leak',
          title: 'Leak',
          severity: 'info',
          category: 'coverage',
          device: 'desktop',
          whatHappened: 'Typed MyP@ssw0rd!',
          whyItMatters: 'x',
          stepsToReproduce: [],
          evidence: { screenshots: [], logs: ['password was MyP@ssw0rd!'] },
          confidence: 'verified',
        }),
      ],
      counts: { blocker: 0, major: 0, minor: 0, info: 1 },
    });
    const written = await writeReport(dir, leaky, [], (text) =>
      text.split('MyP@ssw0rd!').join('[hidden]'),
    );
    for (const path of [written.jsonPath, written.htmlPath, written.markdownPath]) {
      const text = await readFile(path, 'utf8');
      expect(text, path).not.toContain('MyP@ssw0rd!');
      expect(text, path).toContain('[hidden]');
    }
  });

  it('scrubs passwords that contain quotes, backslashes or HTML characters', async () => {
    // These are written differently in JSON ( \" ) and HTML ( &lt; ), so scrubbing the finished
    // files would miss them. The report text is scrubbed before any file is produced.
    const password = 'p"a\\ss<&>word';
    const leaky = report({ passed: [`Logged in with ${password}`] });
    const written = await writeReport(dir, leaky, [], (text) =>
      text.split(password).join('[hidden]'),
    );
    expect(JSON.parse(await readFile(written.jsonPath, 'utf8')).passed).toEqual([
      'Logged in with [hidden]',
    ]);
    const html = await readFile(written.htmlPath, 'utf8');
    expect(html).toContain('Logged in with [hidden]');
    expect(html).not.toContain('ss&lt;&amp;&gt;word');
    expect(await readFile(written.markdownPath, 'utf8')).toContain('Logged in with \\[hidden\\]');
  });

  it('redactDeep reaches text at any depth and leaves other values alone', () => {
    const upper = (text: string) => text.toUpperCase();
    expect(redactDeep({ a: 'x', b: [{ c: 'y', d: 3, e: null, f: true }] }, upper)).toEqual({
      a: 'X',
      b: [{ c: 'Y', d: 3, e: null, f: true }],
    });
  });

  it('refuses to write a report that breaks the schema', async () => {
    const broken = { ...report(), verdict: 'maybe' } as unknown as Report;
    await expect(writeReport(dir, broken, [], same)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it('removes screenshots of an earlier run but leaves other files alone', async () => {
    await mkdir(join(dir, 'screenshots'), { recursive: true });
    await writeFile(join(dir, 'screenshots', '07-mobile-old-shot.jpg'), 'old');
    await writeFile(join(dir, 'screenshots', 'my-own-picture.jpg'), 'mine');
    await writeFile(join(dir, 'notes.txt'), 'mine');
    await writeReport(dir, report(), [shot('screenshots/01-desktop-home-page.jpg')], same);
    expect((await readdir(join(dir, 'screenshots'))).sort()).toEqual([
      '01-desktop-home-page.jpg',
      'my-own-picture.jpg',
    ]);
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('mine');
  });
});
