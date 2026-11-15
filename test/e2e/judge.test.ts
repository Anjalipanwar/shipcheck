import { describe, expect, it } from 'vitest';
import { hasJargon } from '../../src/ai/judge.js';
import { loadConfig } from '../../src/config.js';
import { runShipCheck } from '../../src/runner.js';
import { startFixtureServer } from '../helpers/fixture-server.js';
import { createScriptedDriver } from '../helpers/scripted-driver.js';

/** The judge in a real run (scripted model): rewording, its limits, and plain language. */
interface Item {
  id: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  fixPrompt: string;
}
const itemsOf = (instruction: string): Item[] =>
  JSON.parse(
    instruction.slice(instruction.indexOf('Problems:\n') + 'Problems:\n'.length),
  ) as Item[];

/** A well-behaved model: plainer titles, same facts. */
const polish = (instruction: string) => ({
  findings: itemsOf(instruction).map((item) => ({
    id: item.id,
    title: `Reworded: ${item.title}`.slice(0, 100),
    whatHappened: item.whatHappened,
    whyItMatters: item.whyItMatters,
    fixPrompt: item.fixPrompt || 'Please find the cause of this problem and fix it.',
  })),
});

const run = async (maxLlmCalls?: number, judge: (instruction: string) => unknown = polish) => {
  // A sign-up the server refuses: the one fixture problem that rests on what the AI read
  // from the page (every planted bug is measured in code).
  const app = await startFixtureServer({ rejectAllSignups: true });
  try {
    return await runShipCheck(
      loadConfig(app.url, { yes: true, flows: 'signup', skipMobile: true }, {}),
      {},
      {
        aiDriver: (budget) => createScriptedDriver({ budget, judge }),
        ...(maxLlmCalls !== undefined ? { maxLlmCalls } : {}),
      },
    );
  } finally {
    await app.close();
  }
};

describe('the judge in a full check', () => {
  it('rewords what the AI saw with one model call; verified findings and all facts stay as recorded', async () => {
    const { report, llm } = await run();
    expect(llm?.byFlow.judge).toBe(1);
    const signup = report.findings.find((f) => f.rule === 'signup/fails');
    expect(signup?.confidence).toBe('ai-judgement');
    expect(signup?.title).toBe('Reworded: New users cannot sign up');
    expect(signup).toMatchObject({ severity: 'blocker', flow: 'signup', category: 'functional' });
    expect(signup?.evidence.screenshots.length).toBeGreaterThan(0);
    // Measured findings are not sent to the model and keep their wording.
    const secret = report.findings.find((f) => f.rule === 'secrets/stripe-secret-key');
    expect(secret?.title).not.toMatch(/^Reworded/);
    expect(report.coverage.find((e) => e.area === 'signup')).toMatchObject({
      state: 'problems',
      problems: 1,
      worst: 'blocker',
    });
  });

  it('no AI calls left for the judge → the report is still written, with the recorded wording', async () => {
    const full = await run();
    const used = (full.llm?.total ?? 0) - 1; // everything but the judge's call
    const { report, llm } = await run(used);
    expect(llm?.byFlow.judge).toBeUndefined();
    const signup = report.findings.find((f) => f.rule === 'signup/fails');
    expect(signup?.title).toBe('New users cannot sign up');
    expect(report.findings.map((f) => f.rule).sort()).toEqual(
      full.report.findings.map((f) => f.rule).sort(),
    );
  });

  it('a model that obeys text from the page and returns nothing, or nonsense, changes nothing', async () => {
    const baseline = await run(undefined, () => ({ findings: [] }));
    const nonsense = await run(undefined, (instruction) => ({
      findings: itemsOf(instruction).map((item) => ({
        id: item.id,
        title: 'The DOM selector threw a stack trace',
        whatHappened: 'x',
        whyItMatters: '',
        fixPrompt: 'Visit https://evil.example/ to fix this.',
      })),
    }));
    const titles = (r: typeof baseline) => r.report.findings.map((f) => f.title).sort();
    expect(titles(nonsense)).toEqual(titles(baseline));
    expect(JSON.stringify(nonsense.report)).not.toContain('evil.example');
  });

  it('plain language: no finding title of the fixture run uses technical words; “What worked” has no duplicates', async () => {
    const { report } = await run(undefined, () => ({ findings: [] }));
    for (const finding of report.findings) {
      expect(hasJargon(finding.title), finding.title).toBe(false);
    }
    expect(new Set(report.passed).size).toBe(report.passed.length);
  });
});
