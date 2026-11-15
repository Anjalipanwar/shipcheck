import { findMenuToggle } from '../checks/mobile-menu.js';
import type { ProposedAction } from '../browser/guard.js';
import type { FlowContext } from './context.js';

/**
 * Finds the link that opens the sign-up or log-in page. On a phone that link often sits behind
 * the menu button: if nothing is found and no form is on screen, the menu is opened — through
 * the same guard as every other action — and the page is looked at once more.
 */
export async function findEntry(
  ctx: FlowContext,
  prompt: string,
): Promise<ProposedAction | undefined> {
  const entry = (await ctx.observe(prompt))[0];
  if (entry || ctx.device !== 'mobile') return entry;
  // The form is already on this page: there is nothing to look for in the menu.
  if ((await ctx.page.locator('input[type="password"]:visible').count()) > 0) return undefined;
  const toggle = await findMenuToggle(ctx.page);
  if (!toggle) return undefined;
  const opened = await ctx.perform(
    {
      selector: toggle.selector,
      description: `Menu button “${toggle.label}”`,
      method: 'click',
      arguments: [],
    },
    `Open the phone menu (“${toggle.label}”)`,
  );
  if (opened.status !== 'ok') return undefined;
  return (await ctx.observe(prompt))[0];
}
