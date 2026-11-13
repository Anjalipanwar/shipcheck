import { describe, expect, it } from 'vitest';
import {
  codeBlock,
  escapeMarkdown,
  renderMarkdown,
  renderStepSummary,
} from '../../../src/report/markdown.js';
import { finding, makeReport, sampleReport } from './fixtures.js';

describe('escapeMarkdown', () => {
  it('stops text from becoming formatting, links, images, tables or HTML', () => {
    expect(escapeMarkdown('![x](http://evil) <b> a|b *c* _d_ `e`')).toBe(
      '!\\[x\\](http://evil) \\<b\\> a\\|b \\*c\\* \\_d\\_ \\`e\\`',
    );
    expect(escapeMarkdown('line one\n  line two')).toBe('line one line two');
    expect(escapeMarkdown('# not a heading')).toBe('\\# not a heading');
    expect(escapeMarkdown('1. not a list')).toBe('1\\. not a list');
    expect(escapeMarkdown('&lt;')).toBe('&amp;lt;');
  });
});

describe('codeBlock', () => {
  it('uses a fence longer than any backticks inside, so content cannot break out', () => {
    expect(codeBlock('plain')).toBe('```text\nplain\n```');
    expect(codeBlock('a ``` b')).toBe('````text\na ``` b\n````');
    expect(codeBlock('a ````` b').startsWith('``````text')).toBe(true);
  });
});

describe('renderMarkdown', () => {
  const { report } = sampleReport();
  const markdown = renderMarkdown(report);

  it('has the same sections in the same order as the HTML report', () => {
    expect(markdown.split('\n').filter((line) => /^##? /.test(line))).toEqual([
      '# ShipCheck pre-launch report',
      '## Fix these first',
      '## All issues (4)',
      '## What worked',
      '## What we couldn’t test',
    ]);
    expect(markdown.split('\n').filter((line) => line.startsWith('### '))).toEqual([
      '### Login',
      '### Security',
      '### Search and sharing (SEO)',
    ]);
  });

  it('states the verdict, counts, caveat and run details', () => {
    expect(markdown).toContain('**Verdict: Not ready** — 1 blocker · 1 major · 1 minor · 1 info');
    expect(markdown).toContain('> **Note:** This verdict is based on the automatic checks only.');
    expect(markdown).toContain('- **Date:** 13 November 2026, 17:57 UTC');
  });

  it('gives each issue its evidence and fix prompt', () => {
    expect(markdown).toContain('#### Login shows no message when the password is wrong');
    expect(markdown).toContain('**Major** · Functionality · Desktop · AI judgement');
    expect(markdown).toContain('- Screenshot: screenshots/02-desktop-login-failed.jpg');
    expect(markdown).toContain('```text\nNo <meta name="description"> found\n```');
    expect(markdown).toContain('```text\nRemove the key from client-side code.\n```');
    expect(markdown.split('**Fix prompt**').length - 1).toBe(2);
  });

  it('handles an empty report', () => {
    const empty = renderMarkdown(makeReport([], { passed: [], notTested: [] }));
    expect(empty).toContain('**Verdict: Ready to launch**');
    expect(empty).toContain('No issues found.');
    expect(empty).toContain('Nothing — every planned check ran.');
  });
});

describe('renderStepSummary', () => {
  it('shows the verdict and one table row per issue', () => {
    const summary = renderStepSummary(sampleReport().report);
    expect(summary).toContain('**Verdict: Not ready**');
    expect(summary).toContain(
      '| Blocker | A secret key is visible to anyone who visits your app | Security | Desktop and phone |',
    );
    expect(summary.split('\n').filter((line) => line.startsWith('| ')).length).toBe(2 + 4);
    expect(summary).toContain('**What we couldn’t test**');
  });

  it('keeps a title with a pipe or line break inside its table cell', () => {
    const summary = renderStepSummary(makeReport([finding({ title: 'a | b\nc' })]));
    expect(summary).toContain('| Minor | a \\| b c | Across the app | Desktop |');
  });
});
