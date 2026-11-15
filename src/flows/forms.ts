import { PROMPTS } from '../ai/prompts.js';
import { carriesTypedValue, isFormRequest } from '../browser/body-keys.js';
import { isRiskyUrl } from '../browser/guard.js';
import { causedByShipCheck } from '../checks/blocked.js';
import { FlowContext, newIdentity, type FlowBody } from './context.js';
import { click, fill, readFields, type Field } from './fields.js';

const MAX_FORMS = 3;
/** SPEC §6.1: messy but harmless input. No attack strings of any kind (SPEC §7.5). */
const LONG_TEXT = 'A'.repeat(5000);
const UNICODE_TEXT = '  Ünïcödé 😀 测试 — text with spaces around it  ';
const BAD_EMAIL = 'not-an-email';
const TEST_MESSAGE = 'This is an automated test message from ShipCheck. Please ignore it.';
/** A message that tells the visitor the input was not accepted. */
const REFUSAL =
  /\b(please (enter|fill|provide|add|check|select|choose)|required|is missing|must (be|have|contain)|invalid|not valid|can(no|')t be (blank|empty)|too (short|long)|bitte|pflichtfeld|erforderlich|ungültig)\b/i;
const FORM_PAGE_WORDS =
  /contact|kontakt|feedback|support|newsletter|subscribe|get in touch|waitlist|demo|anfrage/i;

/** Pages likely to hold a form: the home page plus contact-like pages linked from it. */
async function formPages(ctx: FlowContext): Promise<string[]> {
  await ctx.goto(ctx.homeUrl, 'Open the home page');
  const origin = new URL(ctx.homeUrl).origin;
  const links = await ctx.page
    .evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a as HTMLElement).innerText,
      })),
    )
    .catch(() => []);
  const candidates = links
    .filter(
      (link) =>
        link.href.startsWith(origin) &&
        !isRiskyUrl(link.href) &&
        FORM_PAGE_WORDS.test(`${link.text} ${link.href}`),
    )
    .map((link) => link.href.split('#')[0] as string);
  return [...new Set([...candidates, ctx.homeUrl])].slice(0, MAX_FORMS);
}

/** True if the page has a form that is not for logging in, signing up, searching or paying. */
const hasPlainForm = (ctx: FlowContext): Promise<boolean> =>
  ctx.page
    .evaluate(() =>
      [...document.querySelectorAll('form')].some(
        (form) =>
          !form.querySelector(
            'input[type="password"],input[autocomplete^="cc-"],input[type="search"]',
          ) && form.querySelector('input:not([type="hidden"]),textarea') !== null,
      ),
    )
    .catch(() => false);

/** True if the browser itself is holding the form back because a field is missing or wrong. */
const browserBlocks = (ctx: FlowContext): Promise<boolean> =>
  ctx.page
    .evaluate(() =>
      [...document.querySelectorAll('form:not([novalidate])')].some(
        (form) => !(form as HTMLFormElement).checkValidity(),
      ),
    )
    .catch(() => false);

interface Attempt {
  accepted: string[];
  message: string;
  crashed: boolean;
  blocked: boolean;
}

/** The names and ids of the fields of the form the button belongs to. */
const formKeys = (ctx: FlowContext, button: Field): Promise<string[]> =>
  ctx.page
    .locator(button.action.selector)
    .evaluate((el) =>
      [...(el.closest('form') ?? document).querySelectorAll('input, textarea, select')]
        .filter((field) => (field as HTMLInputElement).type !== 'hidden')
        .flatMap((field) => [field.getAttribute('name') ?? '', field.id])
        .filter(Boolean),
    )
    .catch(() => []);

/**
 * Clicks submit and reports what the app did with it, measured from the network and the page.
 * Only the form's own request counts as "accepted": a tracking beacon sent by the same click
 * says nothing about the form (lesson from a real-app run, SPEC §13 2026-11-15).
 */
async function submit(
  ctx: FlowContext,
  button: Field,
  intent: string,
  typed: readonly string[] = [],
  twice = false,
): Promise<Attempt | undefined> {
  const before = await ctx.snapshot();
  const eventsBefore = ctx.evidence.events.length;
  const held = await browserBlocks(ctx);
  const keys = await formKeys(ctx, button);
  ctx.evidence.watch(typed);
  const result = await ctx.perform(
    twice ? { ...click(button), method: 'doubleClick' } : click(button),
    intent,
  );
  ctx.evidence.watch([]);
  if (result.status === 'blocked') return undefined;
  const after = await ctx.snapshot();
  const fresh = ctx.evidence.events.slice(eventsBefore);
  const message = FlowContext.newText(before, after);
  // With something typed, the form's own request is the one carrying it. With every field
  // empty there is nothing to look for: the request must name the form's fields, and a page
  // that answers "Please enter your name" has refused the form, whatever else was sent.
  const own = (e: Extract<(typeof fresh)[number], { kind: 'write-response' }>): boolean =>
    typed.length > 0 ? carriesTypedValue(e) : isFormRequest(e, keys) && !REFUSAL.test(message);
  return {
    accepted: fresh.flatMap((e) =>
      e.kind === 'write-response' && e.status < 400 && own(e)
        ? [`${e.method} ${e.url} → ${e.status}`]
        : [],
    ),
    message,
    crashed: fresh.some(
      (e) => e.kind === 'page-error' && !causedByShipCheck(e, ctx.evidence.events),
    ),
    blocked: held,
  };
}

/** Flow 5 (SPEC §6.1): submit forms empty, with bad input, and twice in a row. */
export const formsFlow: FlowBody = async (ctx) => {
  let tested = 0;
  for (const url of await formPages(ctx)) {
    const load = async (intent: string) => {
      await ctx.goto(url, intent);
      return readFields(ctx, await ctx.observe(PROMPTS.formFields));
    };
    await ctx.goto(url, 'Open a page that may contain a form');
    if (!(await hasPlainForm(ctx))) continue;
    let fields = await load('Open the form');
    let button = fields.filter((field) => field.kind === 'submit').at(-1);
    const inputs = fields.filter((field) =>
      ['email', 'name', 'text', 'longtext'].includes(field.kind),
    );
    if (!button || inputs.length === 0) continue;
    tested += 1;
    const formName = `the form on ${new URL(url).pathname}`;
    const base = { category: 'forms' as const, url };
    const emailField = inputs.find((field) => field.kind === 'email');
    const saysAccepted = (attempt: Attempt) =>
      attempt.message ? ` and the page said: “${attempt.message}”` : '';

    // A. Completely empty.
    const empty = await submit(ctx, button, `Click “${button.label}” with every field empty`);
    if (!empty) {
      ctx.skip(
        `Forms — ShipCheck did not submit ${formName} (pressing “${button.label}” is not allowed by its safety rules)`,
      );
      continue;
    }
    if (empty.accepted.length > 0) {
      const shot = await ctx.shot('empty form accepted');
      ctx.record({
        ...base,
        rule: 'forms/accepts-empty',
        ok: false,
        title: 'A form accepts a completely empty submission',
        expected:
          'Submitting the form with every field empty shows which fields are required, and nothing is sent.',
        actual: `The empty form was sent to the server and accepted${saysAccepted(empty)}.`,
        severity: 'major',
        whyItMatters:
          'You will receive empty or useless submissions, and people who click by mistake believe their message arrived.',
        steps: [
          `Open ${url}.`,
          'Leave every field empty.',
          `Click “${button.label}”.`,
          'The form is accepted.',
        ],
        screenshots: shot ? [shot] : [],
        logs: [
          ...empty.accepted.map((line) => `Accepted by the server: ${line}`),
          ...(empty.message ? [`Message on the page: ${empty.message}`] : []),
        ],
        fixPrompt: `The form on ${url} can be submitted completely empty. Please mark the required fields as required, validate them in the browser before sending and again on the server, and show a clear message next to each field that is missing.`,
        confidence: 'verified',
      });
    } else {
      ctx.record({
        ...base,
        rule: 'forms/rejects-empty',
        ok: true,
        title: `An empty form is not accepted (${new URL(url).pathname})`,
        expected: 'An empty form is not sent.',
        actual: empty.blocked
          ? 'The browser asked to fill in the required fields.'
          : 'Nothing was sent to the server.',
        severity: 'info',
        whyItMatters: '',
        steps: [],
        screenshots: [],
        logs: [],
        confidence: 'verified',
      });
    }

    // B. Bad input: invalid email, very long text, unusual characters.
    fields = await load('Open the form again');
    button = fields.filter((field) => field.kind === 'submit').at(-1) ?? button;
    for (const field of fields) {
      if (field.kind === 'email')
        await ctx.perform(
          fill(field, BAD_EMAIL),
          `Type an invalid email address into “${field.label}”`,
        );
      else if (field.kind === 'name' || field.kind === 'text')
        await ctx.perform(fill(field, LONG_TEXT), `Type 5,000 characters into “${field.label}”`);
      else if (field.kind === 'longtext')
        await ctx.perform(
          fill(field, UNICODE_TEXT),
          `Type text with accents, emoji and extra spaces into “${field.label}”`,
        );
    }
    const bad = await submit(ctx, button, `Click “${button.label}” with the bad input`, [
      BAD_EMAIL,
      LONG_TEXT,
      UNICODE_TEXT.trim(),
    ]);
    const longField = fields.find((field) => field.kind === 'name' || field.kind === 'text');
    if (bad?.crashed) {
      const shot = await ctx.shot('form crashed');
      ctx.record({
        ...base,
        rule: 'forms/crash-on-unusual-input',
        ok: false,
        title: 'A form breaks when given unusual input',
        expected: 'Very long text, emoji and accented letters are handled without errors.',
        actual: 'The page’s code crashed while handling the input.',
        severity: 'major',
        whyItMatters:
          'Real people paste long text and use emoji and non-English letters every day.',
        steps: [
          `Open ${url}.`,
          'Type 5,000 characters, emoji and accented letters into the fields.',
          `Click “${button.label}”.`,
        ],
        screenshots: shot ? [shot] : [],
        logs: ctx.evidence.events
          .flatMap((e) =>
            e.kind === 'page-error' && !causedByShipCheck(e, ctx.evidence.events) ? [e.text] : [],
          )
          .slice(-3),
        fixPrompt: `The form on ${url} throws a JavaScript error when a field contains 5,000 characters, emoji or accented letters. Please handle such input safely and add sensible length limits.`,
        confidence: 'verified',
      });
    } else if (bad && bad.accepted.length > 0 && emailField) {
      const shot = await ctx.shot('invalid input accepted');
      ctx.record({
        ...base,
        rule: 'forms/accepts-invalid',
        ok: false,
        title: `A form accepts an invalid email address${longField ? ' and a 5,000-character name' : ''}`,
        expected: 'An email address without “@” is refused, and very long text is limited.',
        actual: `The form was sent with “${BAD_EMAIL}” as the email address${longField ? ` and 5,000 characters in “${longField.label}”` : ''}, and the server accepted it${saysAccepted(bad)}.`,
        severity: 'major',
        whyItMatters:
          'You cannot reply to people whose email address is wrong, and oversized input can fill your database or break pages that show it.',
        steps: [
          `Open ${url}.`,
          `Type “${BAD_EMAIL}” into “${emailField.label}”.`,
          ...(longField ? [`Type 5,000 characters into “${longField.label}”.`] : []),
          `Click “${button.label}”.`,
          'The form is accepted.',
        ],
        screenshots: shot ? [shot] : [],
        logs: [
          ...bad.accepted.map((line) => `Accepted by the server: ${line}`),
          ...(bad.message ? [`Message on the page: ${bad.message}`] : []),
        ],
        fixPrompt: `The form on ${url} accepts “${BAD_EMAIL}” as an email address${longField ? ' and 5,000 characters in a short text field' : ''}. Please validate the email format and add maximum lengths, both in the browser and on the server, with a clear message next to the field.`,
        confidence: 'verified',
      });
    } else if (bad) {
      ctx.record({
        ...base,
        rule: 'forms/handles-bad-input',
        ok: true,
        title: `Bad input is handled without errors (${new URL(url).pathname})`,
        expected: 'Invalid or unusual input is refused or handled without errors.',
        actual:
          bad.accepted.length > 0
            ? 'The form handled long and unusual text without errors.'
            : 'The form was not sent.',
        severity: 'info',
        whyItMatters: '',
        steps: [],
        screenshots: [],
        logs: [],
        confidence: 'verified',
      });
    }

    // C. Valid input, button clicked twice quickly.
    fields = await load('Open the form once more');
    button = fields.filter((field) => field.kind === 'submit').at(-1) ?? button;
    const identity = newIdentity();
    for (const field of fields) {
      if (field.kind === 'email')
        await ctx.perform(
          fill(field, identity.email),
          `Type a valid test email address into “${field.label}”`,
        );
      else if (field.kind === 'name')
        await ctx.perform(fill(field, identity.name), `Type a test name into “${field.label}”`);
      else if (field.kind === 'text')
        await ctx.perform(fill(field, 'ShipCheck test'), `Type test text into “${field.label}”`);
      else if (field.kind === 'longtext')
        await ctx.perform(fill(field, TEST_MESSAGE), `Type a test message into “${field.label}”`);
    }
    const double = await submit(
      ctx,
      button,
      `Click “${button.label}” twice quickly`,
      [identity.email, identity.name, TEST_MESSAGE],
      true,
    );
    if (double && double.accepted.length >= 2) {
      const shot = await ctx.shot('sent twice');
      ctx.record({
        ...base,
        rule: 'forms/duplicate-submit',
        ok: false,
        title: 'Clicking a form’s button twice sends it twice',
        expected: 'A quick double click sends the form once.',
        actual: `The form was sent ${double.accepted.length} times.`,
        severity: 'minor',
        whyItMatters:
          'Impatient users double-click. You get duplicate messages, bookings or records.',
        steps: [
          `Open ${url}.`,
          'Fill in the form with valid data.',
          `Double-click “${button.label}”.`,
          'The form is sent twice.',
        ],
        screenshots: shot ? [shot] : [],
        logs: double.accepted.map((line) => `Accepted by the server: ${line}`),
        fixPrompt: `The form on ${url} is submitted twice when its button is double-clicked. Please disable the button while the request is running and ignore further submits until it has finished.`,
        confidence: 'verified',
      });
    } else if (double && double.accepted.length === 1) {
      ctx.record({
        ...base,
        rule: 'forms/single-submit',
        ok: true,
        title: `A double click sends the form only once (${new URL(url).pathname})`,
        expected: 'A quick double click sends the form once.',
        actual: 'The form was sent once.',
        severity: 'info',
        whyItMatters: '',
        steps: [],
        screenshots: [],
        logs: [],
        confidence: 'verified',
      });
    }
  }
  if (tested === 0) {
    ctx.skip(
      'Forms — no form (other than log-in, sign-up or payment) was found on the home page or on contact-like pages linked from it',
      { kind: 'absent', reason: 'ShipCheck found no form besides log-in and sign-up' },
    );
  }
};
