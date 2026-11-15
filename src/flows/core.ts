import { z } from 'zod';
import { PROMPTS } from '../ai/prompts.js';
import { readElementFacts } from '../browser/element.js';
import { ADVICE } from '../report/present.js';
import type { FlowBody } from './context.js';

const MAX_GOAL_STEPS = 6;
const MAX_REFUSALS = 2;

const GoalSchema = z.object({ goal: z.string() });
const OutcomeSchema = z.object({
  accomplished: z.boolean(),
  errorVisible: z.boolean(),
  whatIsVisible: z.string(),
});

const OPEN_DIALOG = '[role="dialog"]:visible, [role="alertdialog"]:visible, dialog[open]';

/** How often `phrase` occurs in `text`. */
const occurrences = (text: string, phrase: string): number => text.split(phrase).length - 1;

/**
 * The text of something chosen by a click, and the shorter phrases it starts with ("Rainbow
 * chickpea bowls 15 min" → "Rainbow chickpea bowls 15", "Rainbow chickpea bowls"): the list the
 * choice lands in often shows only the name. At least two words and eight characters, so that a
 * common word cannot count as proof.
 */
function phrasesOf(label: string): string[] {
  const words = label.replace(/\s+/g, ' ').trim().split(' ');
  const phrases: string[] = [];
  for (let length = words.length; length >= 2; length -= 1) {
    const phrase = words.slice(0, length).join(' ');
    if (phrase.length >= 8) phrases.push(phrase);
  }
  return phrases;
}

/** Flow 4 (SPEC §6.1): try the app's main action end to end, then check it survives a refresh. */
export const coreFlow: FlowBody = async (ctx) => {
  if (!ctx.shared.loggedIn) await ctx.goto(ctx.homeUrl, 'Open the home page');
  const startUrl = ctx.page.url();

  let goal = ctx.config.goal;
  if (!goal) {
    goal = (await ctx.extract(PROMPTS.mainAction, GoalSchema)).goal.trim();
    if (!goal) {
      ctx.skip(
        'Main feature — ShipCheck could not tell what the app’s main action is. Tell it with --goal "…"',
        { action: ADVICE.goal },
      );
      return;
    }
  }

  const done: string[] = [];
  const typed: string[] = [];
  /** Choices clicked inside an open dialog (a recipe, a time slot…), with the page they were made on. */
  const picked: { label: string; url: string }[] = [];
  const dialogOpen = async () => (await ctx.page.locator(OPEN_DIALOG).count()) > 0;
  const textAtStart = (await ctx.snapshot()).text;
  let refusals = 0;
  let wall = false;
  let previous = '';
  for (let step = 0; step < MAX_GOAL_STEPS; step += 1) {
    const next = (await ctx.observe(PROMPTS.nextStep(goal, done)))[0];
    if (!next) break;
    // The same action proposed twice in a row means the model has nothing new to do.
    const signature = `${next.method}|${next.selector}|${next.arguments?.join('|') ?? ''}`;
    if (signature === previous) break;
    previous = signature;
    // The main-feature flow never signs up or logs in by itself. A password field on the way
    // means the feature is behind an account; making up details there creates junk accounts and
    // gets refused for reasons that say nothing about the feature (SPEC §13, 2026-11-15).
    const target = await readElementFacts(ctx.page, next.selector);
    if (target?.type === 'password') {
      ctx.evidence.protect(next.arguments?.[0]); // whatever the model made up is never shown
      wall = true;
      break;
    }
    const inDialog = await dialogOpen();
    const result = await ctx.perform(next, next.description);
    if (result.status === 'blocked') {
      refusals += 1;
      done.push(`not allowed and skipped: ${next.description}`);
      if (refusals >= MAX_REFUSALS) break;
      continue;
    }
    if (result.status === 'failed') {
      done.push(`could not do: ${next.description}`);
      continue;
    }
    if (inDialog && (next.method ?? '').toLowerCase() === 'click' && result.facts?.text) {
      picked.push({ label: result.facts.text, url: ctx.page.url() });
    }
    const value = next.arguments?.[0];
    const isText = ['fill', 'type'].includes((next.method ?? '').toLowerCase());
    if (isText && value && value.trim().length >= 3 && result.facts?.type !== 'password') {
      typed.push(value.trim());
    }
    // A password is never written down, not even one the AI made up.
    const shown = result.facts?.type === 'password' ? 'a password' : `“${value}”`;
    done.push(isText && value ? `typed ${shown} into ${next.description}` : next.description);
  }

  if (wall) {
    ctx.skip(
      'Main feature — the app asks for an account before it can be used, and ShipCheck was not logged in. Give ShipCheck a test account with --email and --password',
      {
        reason: 'your app asks to sign up or log in first, and ShipCheck had no working account',
        action: ADVICE.account,
      },
    );
    return;
  }
  const performed = done.filter((line) => !/^(not allowed|could not do)/.test(line));
  if (performed.length === 0) {
    ctx.skip(
      `Main feature — ShipCheck found no way to “${goal}” on ${startUrl}. Describe the main task with --goal "…"`,
      { reason: 'ShipCheck found no way to use the main feature', action: ADVICE.goal },
    );
    return;
  }
  const steps = [
    `Open ${startUrl}.`,
    ...performed.map((line) => `${line[0]?.toUpperCase()}${line.slice(1)}.`),
  ];
  const base = { category: 'functional' as const, url: startUrl, steps };

  // A dialog the last step left open would hide the result (and its text would be counted as
  // the page's): close it the way a user would, with the Escape key, before judging.
  if (await dialogOpen()) {
    await ctx.page.keyboard.press('Escape').catch(() => undefined);
    await ctx.settle();
    ctx.evidence.logAction({
      device: ctx.device,
      flow: 'core',
      intent: 'Close the open dialog (Escape key)',
      action: 'press',
      locator: 'keyboard: Escape',
      url: ctx.page.url(),
      result: (await dialogOpen()) ? 'failed' : 'ok',
    });
  }

  // Measured first: text the tester typed that now shows on the page (and did not before) is
  // proof the action worked. So is something chosen by a click in a dialog that now shows on
  // the same page more often than at the start. Only without such proof is the model asked.
  const textNow = (await ctx.snapshot()).text;
  const typedProof = typed.find((value) => textNow.includes(value) && !textAtStart.includes(value));
  const stillOpen = await dialogOpen();
  const pickedProof = stillOpen
    ? undefined
    : picked
        .filter((pick) => pick.url === ctx.page.url() && pick.url === startUrl)
        .flatMap((pick) => phrasesOf(pick.label))
        .find((phrase) => occurrences(textNow, phrase) > occurrences(textAtStart, phrase));
  const proof = typedProof ?? pickedProof;
  let confidence: 'verified' | 'ai-judgement' = 'verified';
  let seen = typedProof
    ? `“${typedProof}” now shows on the page.`
    : pickedProof
      ? `“${pickedProof}” was chosen and now shows on the page (${occurrences(textNow, pickedProof)} times, before: ${occurrences(textAtStart, pickedProof)}).`
      : '';
  if (!proof) {
    const outcome = await ctx.extract(PROMPTS.goalOutcome(goal, performed), OutcomeSchema);
    confidence = 'ai-judgement';
    seen = outcome.whatIsVisible;
    if (!outcome.accomplished && outcome.errorVisible) {
      const shot = await ctx.shot('main feature failed');
      ctx.record({
        ...base,
        rule: 'core/fails',
        ok: false,
        title: `The main feature shows an error: ${goal}`,
        expected: `A user can ${goal.replace(/\.$/, '').toLowerCase()}.`,
        actual: outcome.whatIsVisible || 'An error message appeared instead of the result.',
        severity: 'blocker',
        whyItMatters: 'The main thing the app is for does not work for a new user.',
        screenshots: shot ? [shot] : [],
        logs: [`What the page showed afterwards: ${outcome.whatIsVisible || '(an error message)'}`],
        fixPrompt: `In my app, the main action (“${goal}”) ends in an error when a new user tries it with these steps: ${steps.join(' ')} Afterwards the page shows: ${outcome.whatIsVisible || 'an error message'}. Please find the cause and fix it.`,
        confidence: 'ai-judgement',
      });
      return;
    }
    if (!outcome.accomplished) {
      // No error on screen and no proof either way: saying "broken" would be a guess.
      ctx.skip(
        `Main feature — ShipCheck tried to “${goal}” but could not confirm whether it worked. Please check it by hand, or describe the task more exactly with --goal "…"`,
        {
          reason: 'ShipCheck tried the main feature but could not confirm whether it worked',
          action: ADVICE.goalOrHand,
        },
      );
      return;
    }
  }
  ctx.record({
    ...base,
    rule: 'core/works',
    ok: true,
    title: `The main feature works: ${goal}`,
    expected: `A user can ${goal.replace(/\.$/, '').toLowerCase()}.`,
    actual: seen,
    severity: 'info',
    whyItMatters: '',
    screenshots: [],
    logs: [],
    confidence,
  });

  // Is what the user entered still there after a refresh?
  const visibleBefore = (await ctx.snapshot()).text;
  const kept = typed.filter((value) => visibleBefore.includes(value));
  if (kept.length === 0) return;
  const here = ctx.page.url();
  await ctx.goto(here, 'Refresh the page');
  const visibleAfter = (await ctx.snapshot()).text;
  const lost = kept.filter((value) => !visibleAfter.includes(value));
  if (lost.length > 0) {
    const shot = await ctx.shot('data gone after refresh');
    ctx.record({
      ...base,
      rule: 'core/data-lost-on-refresh',
      ok: false,
      title: 'What you enter disappears after refreshing the page',
      expected: 'Data a user saves is still there after the page is refreshed.',
      actual: `“${lost[0]}” was visible after saving, but was gone after a refresh.`,
      severity: 'major',
      whyItMatters: 'Users will believe their work was saved and then find it gone.',
      steps: [...steps, 'Refresh the page.', 'The new entry is gone.'],
      screenshots: shot ? [shot] : [],
      logs: lost.map((value) => `Visible before the refresh, missing after: “${value}”`),
      url: here,
      fixPrompt: `In my app, data entered through the main action (“${goal}”) disappears after a page refresh. Please make sure it is saved to the database (not only kept in memory) and loaded again when the page opens.`,
      confidence: 'verified',
    });
  } else {
    ctx.record({
      ...base,
      rule: 'core/data-survives-refresh',
      ok: true,
      title: 'What you enter is still there after refreshing the page',
      expected: 'Data a user saves is still there after the page is refreshed.',
      actual: `“${kept[0]}” was still visible after a refresh.`,
      severity: 'info',
      whyItMatters: '',
      screenshots: [],
      logs: [],
      confidence: 'verified',
    });
  }
};
