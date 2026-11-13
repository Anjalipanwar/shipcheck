import { PROMPTS } from '../ai/prompts.js';
import { FlowContext, type FlowBody } from './context.js';

const MAX_TARGETS = 4;

const sameAddress = (a: string, b: string): boolean => {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
};

/** Flow 1 (SPEC §6.1): open the home page and click the main button and the menu links. */
export const landingFlow: FlowBody = async (ctx) => {
  await ctx.goto(ctx.homeUrl, 'Open the home page');
  const targets = (await ctx.observe(PROMPTS.landingTargets)).slice(0, MAX_TARGETS);
  if (targets.length === 0) {
    ctx.skip('Landing page — no main button or menu links were found to click');
    return;
  }

  for (const target of targets) {
    if (!sameAddress(ctx.page.url(), ctx.homeUrl))
      await ctx.goto(ctx.homeUrl, 'Go back to the home page');
    const before = await ctx.snapshot();
    const blockedBefore = ctx.evidence.count('blocked-navigation');
    const failedBefore = ctx.evidence.count('bad-response');
    const done = await ctx.perform(target, `Click “${target.description}”`);
    const name = (done.facts?.text || done.facts?.label || target.description).slice(0, 60);
    if (done.status !== 'ok') continue;

    const after = await ctx.snapshot();
    await ctx.closeExtraPages();
    // Links to other websites are stopped by the domain lock; that is not a dead button.
    if (ctx.evidence.count('blocked-navigation') > blockedBefore) continue;
    const href = done.facts?.href ?? '';
    const pointsHere = href !== '' && (sameAddress(href, before.url) || href.includes('#'));

    if (FlowContext.changed(before, after)) {
      // Dead links are reported once, by the automatic link check; here only buttons count.
      const brokeNow =
        ctx.evidence.count('bad-response') > failedBefore && after.url !== before.url;
      if (!brokeNow) {
        ctx.record({
          rule: 'landing/target-works',
          ok: true,
          title: `“${name}” on the home page leads somewhere`,
          expected: `Clicking “${name}” opens a page or changes the screen.`,
          actual: after.url !== before.url ? `It opened ${after.url}.` : 'The page changed.',
          severity: 'info',
          category: 'functional',
          whyItMatters: '',
          steps: [],
          screenshots: [],
          logs: [],
          url: before.url,
          confidence: 'verified',
        });
      }
      continue;
    }
    if (pointsHere) continue;
    const shot = await ctx.shot(`nothing happened after ${name}`);
    ctx.record({
      rule: 'landing/dead-button',
      ok: false,
      title: `“${name}” on the home page does nothing when clicked`,
      expected: `Clicking “${name}” opens a page or changes something on screen.`,
      actual:
        'Nothing happened: the address, the visible text and the page content all stayed exactly the same.',
      severity: 'major',
      category: 'functional',
      whyItMatters:
        'A first-time visitor who clicks a button and sees nothing happen assumes the app is broken and leaves.',
      steps: [`Open ${before.url}.`, `Click “${name}”.`, 'Nothing happens.'],
      screenshots: shot ? [shot] : [],
      logs: [`Clicked: ${target.selector}`, `Address before and after: ${before.url}`],
      url: before.url,
      fixPrompt: `On my home page, clicking “${name}” does nothing. Please find that element, check why its click handler or link target is missing, and make it lead where it should.`,
      confidence: 'verified',
    });
  }
};
