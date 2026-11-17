import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Evidence } from '../../../src/browser/evidence.js';
import { makeFinding, ReportSchema, type Report } from '../../../src/report/schema.js';
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

describe('a password that is an everyday word (audit A-03)', () => {
  const withWords = (): Report =>
    report({
      verdict: 'partly-tested',
      meta: { ...report().meta, mode: 'full' },
      passed: ['ShipCheck tested the form on a mobile screen', 'Checked the log-in'],
      notTested: ['Your password test was refused at /login?password=test'],
      coverage: coverageFor('full', { login: { state: 'not-tested', note: 'not tested yet' } }),
      findings: [
        makeFinding({
          rule: 'mobile/check-test',
          title: 'The test page breaks on a mobile phone',
          severity: 'minor',
          category: 'mobile',
          flow: 'mobile',
          device: 'mobile',
          whatHappened: 'The page said: “Wrong password: test”.',
          whyItMatters: 'Tests and checks matter.',
          stepsToReproduce: ['Open it.'],
          evidence: { screenshots: [], logs: ['typed test'], url: 'https://example.com/test' },
          confidence: 'verified',
        }),
      ],
    });

  it.each(['test', 'mobile', 'check', 'tested', 'Login'])(
    'password “%s”: the report is still written, fixed values and ordinary words are untouched, the word on its own is hidden',
    async (password) => {
      const evidence = new Evidence();
      evidence.protect(password);
      const original = withWords();
      const written = await writeReport(dir, original, [], (text) => evidence.redact(text));
      const json = JSON.parse(await readFile(written.jsonPath, 'utf8')) as Report;
      // Fixed values (verdict, states, rule, id, device…) are never changed.
      expect(json.verdict).toBe(original.verdict);
      expect(json.coverage.map((c) => [c.area, c.state, c.worst])).toEqual(
        original.coverage.map((c) => [c.area, c.state, c.worst]),
      );
      expect(json.findings[0]?.rule).toBe('mobile/check-test');
      expect(json.findings[0]?.id).toBe(original.findings[0]?.id);
      expect(json.findings[0]?.device).toBe('mobile');
      // The password never shows up as a word of its own, nor as an address parameter.
      // Only free text is checked: fixed values above may legitimately contain the word.
      const finding = json.findings[0];
      const text = JSON.stringify([
        json.passed,
        json.notTested,
        json.coverage.map((c) => c.note),
        finding?.title,
        finding?.whatHappened,
        finding?.evidence,
      ]);
      expect(text).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}])${password}(?![\\p{L}\\p{N}])`, 'u'));
      expect(text).toContain('password=[hidden]');
      // Longer words that merely contain it stay readable.
      if (password === 'test') {
        expect(json.passed[0]).toBe('ShipCheck tested the form on a mobile screen');
        expect(json.findings[0]?.whatHappened).toBe('The page said: “Wrong password: [hidden]”.');
      }
    },
  );

  it('the same holds for the copy the terminal and the step summary use (runner)', () => {
    const evidence = new Evidence();
    evidence.protect('check');
    const safe = redactDeep(withWords(), (text) => evidence.redact(text));
    expect(() => ReportSchema.parse(safe)).not.toThrow();
    expect(safe.passed[1]).toBe('Checked the log-in');
  });
});
