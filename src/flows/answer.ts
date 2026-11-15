import { carriesTypedValue } from '../browser/body-keys.js';
import type { FlowContext, Snapshot } from './context.js';

/** How long to wait for the app to move on after the server accepted the form. */
const REDIRECT_WAIT_MS = 10_000;
/** How long to wait for the app to send the form's request at all. */
const ANSWER_WAIT_MS = 3_000;
/** How long to wait for the form to leave the screen once the page address has changed. */
const SCREEN_WAIT_MS = 5_000;

type Answer = { status: number };

export interface Submission {
  /** What the server said to the form's own request (not to tracking beacons). */
  answers(): Answer[];
  /** The server refused the form's request (answer code 400 or higher). */
  refused(): boolean;
  /** The server answered the form's request and did not refuse it. */
  accepted(): boolean;
  /**
   * Waits for the app's answer after the submit button was clicked, then returns the page as it
   * looks afterwards. Many apps answer slowly and show "Logging in…" first; judging that loading
   * screen calls a working form broken. The wait ends when the page address changes or the
   * server refuses — with `until: 'answer'`, as soon as the server answers at all. If no request
   * of the form is answered within a few seconds, nothing was sent (the page refused the input
   * itself, or the button does nothing) and waiting is over.
   */
  outcome(before: Snapshot, firstLook: Snapshot, until?: 'new-page' | 'answer'): Promise<Snapshot>;
}

/**
 * Call just before clicking a form's submit button. `typed` are values ShipCheck typed into the
 * form (the email address): a request that carries one of them is the form's own.
 */
export function watchSubmission(ctx: FlowContext, typed: readonly string[]): Submission {
  const eventsBefore = ctx.evidence.events.length;
  ctx.evidence.watch(typed);
  const answers = (): Answer[] =>
    ctx.evidence.events
      .slice(eventsBefore)
      .flatMap((e) => (e.kind === 'write-response' && carriesTypedValue(e) ? [e] : []));
  const refused = () => answers().some((e) => e.status >= 400);
  return {
    answers,
    refused,
    accepted: () => !refused() && answers().some((e) => e.status < 400),
    async outcome(before, firstLook, until = 'new-page') {
      const started = Date.now();
      while (ctx.page.url() === before.url && !refused()) {
        if (until === 'answer' && answers().length > 0) break;
        const waited = Date.now() - started;
        if (waited >= REDIRECT_WAIT_MS || (waited >= ANSWER_WAIT_MS && answers().length === 0))
          break;
        if (!(await ctx.pause(250))) break;
      }
      let after = firstLook;
      if (ctx.page.url() !== before.url || answers().length > 0) {
        await ctx.settle(); // let the new page, or the error message, appear
        // Some apps change the address first and load the screen behind it afterwards: for a
        // moment the new address still shows the old form. Give the form time to go away.
        const moved = Date.now();
        while (
          ctx.page.url() !== before.url &&
          Date.now() - moved < SCREEN_WAIT_MS &&
          (await ctx.page.locator('input[type="password"]:visible').count()) > 0
        ) {
          if (!(await ctx.pause(250))) break;
        }
        after = await ctx.snapshot();
      }
      ctx.evidence.watch([]);
      return after;
    },
  };
}
