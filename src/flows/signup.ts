import { z } from 'zod';
import { PROMPTS } from '../ai/prompts.js';
import { ADVICE } from '../report/present.js';
import { FlowContext, newIdentity, type FlowBody } from './context.js';
import { click, fill, first, readFields } from './fields.js';

const OutcomeSchema = z.object({
  accountCreated: z.boolean(),
  needsEmailVerification: z.boolean(),
  captchaBlocked: z.boolean(),
  errorText: z.string(),
});

/** Flow 2 (SPEC §6.1): create an account with a generated test identity. */
export const signupFlow: FlowBody = async (ctx) => {
  if (ctx.config.email && ctx.config.password) {
    ctx.shared.account = { email: ctx.config.email, password: ctx.config.password };
    ctx.skip('Signing up — skipped, because you gave ShipCheck an existing test account', {
      kind: 'choice',
      reason: 'you gave ShipCheck a test account',
    });
    return;
  }
  await ctx.goto(ctx.homeUrl, 'Open the home page');
  const entry = (await ctx.observe(PROMPTS.signupEntry))[0];
  if (entry) {
    const opened = await ctx.perform(entry, 'Open the sign-up page');
    if (opened.status === 'blocked') {
      ctx.skip(`Signing up — ShipCheck did not click the sign-up link (${opened.reason})`);
      return;
    }
  }

  const fields = await readFields(ctx, await ctx.observe(PROMPTS.signupForm));
  const password = first(fields, 'password');
  const submit = fields.filter((field) => field.kind === 'submit').at(-1);
  if (!password || !submit) {
    ctx.skip(
      'Signing up — no sign-up form with a password was found. If the app only offers “Sign in with Google” or similar, give ShipCheck a test account with --email and --password',
      // No sign-up link and no form on a desktop screen: the app has no sign-up page.
      !entry && ctx.device === 'desktop'
        ? { kind: 'absent', reason: 'ShipCheck found no sign-up page' }
        : { reason: 'no sign-up form with a password was found', action: ADVICE.account },
    );
    return;
  }

  const identity = newIdentity();
  ctx.evidence.protect(identity.password);
  const formUrl = ctx.page.url();
  for (const field of fields) {
    if (field.kind === 'email')
      await ctx.perform(
        fill(field, ctx.config.email ?? identity.email),
        `Type a test email into “${field.label}”`,
      );
    else if (field.kind === 'password')
      await ctx.perform(
        fill(field, identity.password),
        `Type a test password into “${field.label}”`,
      );
    else if (field.kind === 'name')
      await ctx.perform(fill(field, identity.name), `Type a test name into “${field.label}”`);
    else if (field.kind === 'text')
      await ctx.perform(fill(field, 'ShipCheck test'), `Type test text into “${field.label}”`);
    else if (field.kind === 'checkbox') await ctx.perform(click(field), `Tick “${field.label}”`);
  }
  const email = ctx.config.email ?? identity.email;
  const before = await ctx.snapshot();
  const sent = await ctx.perform(click(submit), `Click “${submit.label}” to create the account`);
  if (sent.status === 'blocked') {
    ctx.skip(`Signing up — ShipCheck did not press “${submit.label}” (${sent.reason})`);
    return;
  }
  const after = await ctx.snapshot();
  const steps = [
    `Open ${formUrl}.`,
    `Fill in the sign-up form with a new email address (ShipCheck used ${email}) and a password of 20 characters.`,
    `Click “${submit.label}”.`,
  ];
  const base = { category: 'functional' as const, url: formUrl, steps };

  if (!FlowContext.changed(before, after)) {
    const shot = await ctx.shot('nothing happened');
    ctx.record({
      ...base,
      rule: 'signup/button-does-nothing',
      ok: false,
      title: 'The sign-up button does nothing',
      expected:
        'After submitting the sign-up form, the account is created or a message explains what is wrong.',
      actual: `Clicking “${submit.label}” changed nothing: no new page, no message.`,
      severity: 'blocker',
      whyItMatters: 'New users cannot create an account, so nobody new can start using the app.',
      screenshots: shot ? [shot] : [],
      logs: [
        `Clicked: ${submit.action.selector}`,
        'Page address and content were identical before and after the click',
      ],
      fixPrompt: `On my sign-up page, clicking “${submit.label}” does nothing — no request is sent and no message appears. Please check the button’s click/submit handler and make sure the form is actually submitted, with a visible error message if something is wrong.`,
      confidence: 'verified',
    });
    return;
  }

  // A new address with no password field left on screen means the user was let in.
  const passwordStillThere = (await ctx.page.locator('input[type="password"]:visible').count()) > 0;
  let outcome = {
    accountCreated: after.url !== before.url && !passwordStillThere,
    needsEmailVerification: false,
    captchaBlocked: false,
    errorText: '',
  };
  let confidence: 'verified' | 'ai-judgement' = 'verified';
  if (!outcome.accountCreated) {
    outcome = await ctx.extract(PROMPTS.signupOutcome, OutcomeSchema);
    confidence = 'ai-judgement';
  }

  if (outcome.captchaBlocked) {
    ctx.skip(
      'Signing up — a CAPTCHA (“I am not a robot”) stopped the automatic test. Give ShipCheck a test account with --email and --password to test the rest',
      { reason: 'a CAPTCHA (“I am not a robot”) stopped the test', action: ADVICE.account },
    );
  } else if (outcome.needsEmailVerification) {
    ctx.skip(
      'Signing up — the app asks to confirm the email address first, which ShipCheck cannot do. Give ShipCheck a confirmed test account with --email and --password',
      { reason: 'your app asks new users to confirm their email first', action: ADVICE.account },
    );
  } else if (outcome.accountCreated) {
    ctx.shared.account = { email, password: identity.password };
    ctx.shared.loggedIn = true;
    ctx.record({
      ...base,
      rule: 'signup/works',
      ok: true,
      title: 'Signing up with an email address and password works',
      expected: 'A new user can create an account.',
      actual: `The account was created and the app opened ${after.url}.`,
      severity: 'info',
      whyItMatters: '',
      screenshots: [],
      logs: [],
      confidence,
    });
  } else {
    const shot = await ctx.shot('signup failed');
    const message = outcome.errorText || FlowContext.newText(before, after);
    ctx.record({
      ...base,
      rule: 'signup/fails',
      ok: false,
      title: 'New users cannot sign up',
      expected:
        'A new user with a valid email address and a strong password can create an account.',
      actual: message
        ? `The app answered: “${message}”`
        : 'The account was not created and no clear reason was shown.',
      severity: 'blocker',
      whyItMatters: 'If signing up fails, nobody new can start using the app.',
      screenshots: shot ? [shot] : [],
      logs: [
        message ? `Message on the page: ${message}` : 'No message was shown',
        `Address after submitting: ${after.url}`,
      ],
      fixPrompt: `Signing up in my app fails for a brand-new user with a valid email address and a strong 20-character password.${message ? ` The page shows: “${message}”.` : ''} Please find out why the account is not created (check the sign-up request and the server logs) and fix it.`,
      confidence: 'ai-judgement',
    });
  }
};
