import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PROMPTS } from '../ai/prompts.js';
import { ADVICE } from '../report/present.js';
import { watchSubmission } from './answer.js';
import { FlowContext, newIdentity, type FlowBody } from './context.js';
import { findEntry } from './entry.js';
import { click, fill, first, readFields, type Field } from './fields.js';

const OutcomeSchema = z.object({
  loggedIn: z.boolean(),
  errorVisible: z.boolean(),
  messageText: z.string(),
});

interface LoginForm {
  email: Field;
  password: Field;
  submit: Field;
  url: string;
}

async function findForm(ctx: FlowContext): Promise<LoginForm | undefined> {
  const fields = await readFields(ctx, await ctx.observe(PROMPTS.loginForm));
  const password = first(fields, 'password');
  const email = first(fields, 'email') ?? first(fields, 'text') ?? first(fields, 'name');
  const submit = fields.filter((field) => field.kind === 'submit').at(-1);
  return email && password && submit ? { email, password, submit, url: ctx.page.url() } : undefined;
}

/** Flow 3 (SPEC §6.1): a wrong password once, then the right one, then a page refresh. */
export const loginFlow: FlowBody = async (ctx) => {
  await ctx.goto(ctx.homeUrl, 'Open the home page');
  const entry = await findEntry(ctx, PROMPTS.loginEntry);
  if (entry) {
    const opened = await ctx.perform(entry, 'Open the log-in page');
    if (opened.status === 'blocked') {
      ctx.skip(`Logging in — ShipCheck did not click the log-in link (${opened.reason})`);
      return;
    }
  }
  let form = await findForm(ctx);
  if (!form) {
    ctx.skip(
      'Logging in — no log-in form with email and password was found. If the app only offers “Sign in with Google” or similar, ShipCheck cannot test it in this version',
      // No log-in link and no form on a desktop screen: the app has no log-in. On a phone the
      // link may just sit behind a menu, so that is "not tested", never "not in your app".
      !entry && ctx.device === 'desktop'
        ? { kind: 'absent', reason: 'ShipCheck found no log-in page' }
        : { reason: 'no log-in form with email and password was found', action: ADVICE.byHand },
    );
    return;
  }
  // The account the sign-up flow made or was given — or the one from --email and --password,
  // when signing up was left out with --flows.
  const account =
    ctx.shared.account ??
    (ctx.config.email && ctx.config.password
      ? { email: ctx.config.email, password: ctx.config.password }
      : undefined);
  const email = account?.email ?? newIdentity().email;
  const base = { category: 'functional' as const, url: form.url };

  // 1. Wrong password.
  const wrong = `Wrong-${randomBytes(4).toString('hex')}-pw`;
  ctx.evidence.protect(wrong);
  await ctx.perform(fill(form.email, email), `Type the email address into “${form.email.label}”`);
  await ctx.perform(
    fill(form.password, wrong),
    `Type a wrong password into “${form.password.label}”`,
  );
  const before = await ctx.snapshot();
  const wrongTry = watchSubmission(ctx, [email]);
  const tried = await ctx.perform(
    click(form.submit),
    `Click “${form.submit.label}” with the wrong password`,
  );
  if (tried.status === 'blocked') {
    ctx.skip(`Logging in — ShipCheck did not press “${form.submit.label}” (${tried.reason})`);
    return;
  }
  // Waits for the server's answer: a "Logging in…" label is not yet the app's reaction.
  const after = await wrongTry.outcome(before, await ctx.snapshot(), 'answer');
  const wrongSteps = [
    `Open ${form.url}.`,
    'Type an email address and a password that is wrong.',
    `Click “${form.submit.label}”.`,
  ];
  const noMessage = {
    ...base,
    rule: 'login/no-error-on-wrong-password',
    ok: false,
    title: 'Login shows no message when the password is wrong',
    expected:
      'After a wrong password, the page tells the user that the email or password is not correct.',
    severity: 'major' as const,
    whyItMatters:
      'Someone who mistypes their password sees nothing happen and cannot tell whether the app is broken, slow or just rejected the password. Many will give up.',
    steps: [...wrongSteps, 'No message appears.'],
    fixPrompt: `On my log-in page, when the password is wrong, nothing visible happens. Please show a clear error message next to the form (for example “Email or password is incorrect”) whenever the log-in request fails, and make sure screen readers announce it.`,
  };

  if (!FlowContext.changed(before, after)) {
    const shot = await ctx.shot('wrong password no message');
    ctx.record({
      ...noMessage,
      actual:
        'Nothing visible happened: the page looked exactly the same before and after the click.',
      screenshots: shot ? [shot] : [],
      logs: [
        'Page address and visible text were identical before and after submitting a wrong password',
        ...wrongTry
          .answers()
          .slice(-1)
          .map((e) => `The server answered the log-in request with status ${e.status}`),
      ],
      confidence: 'verified',
    });
  } else {
    const outcome = await ctx.extract(PROMPTS.loginOutcome, OutcomeSchema);
    // What the server said outranks what the model read from the page: a refused log-in did
    // not let anyone in, whatever the page's text claims.
    if (outcome.loggedIn && !wrongTry.refused()) {
      const shot = await ctx.shot('logged in with wrong password');
      ctx.record({
        ...base,
        rule: 'login/accepts-wrong-password',
        ok: false,
        title: 'Login lets people in with a wrong password',
        expected: 'A wrong password is rejected.',
        actual: `After typing a wrong password, the app opened ${after.url} as if the user were logged in.`,
        severity: 'blocker',
        whyItMatters: 'Anyone could open any account without knowing its password.',
        steps: [...wrongSteps, 'The app lets you in.'],
        screenshots: shot ? [shot] : [],
        logs: [`Address after the log-in attempt: ${after.url}`],
        fixPrompt:
          'My app logs users in even when the password is wrong. Please check the log-in logic on the server: the password must be verified against the stored hash, and the session must only be created when it matches.',
        confidence: 'ai-judgement',
      });
      return;
    }
    if (outcome.errorVisible) {
      ctx.record({
        ...base,
        rule: 'login/error-on-wrong-password',
        ok: true,
        title: 'A wrong password shows a clear message',
        expected: noMessage.expected,
        actual: `The page says: “${outcome.messageText || FlowContext.newText(before, after)}”`,
        severity: 'info',
        whyItMatters: '',
        steps: [],
        screenshots: [],
        logs: [],
        confidence: 'ai-judgement',
      });
    } else {
      const shot = await ctx.shot('wrong password no message');
      ctx.record({
        ...noMessage,
        actual:
          'The page changed slightly, but no message about a wrong email or password is visible.',
        screenshots: shot ? [shot] : [],
        logs: [
          `Text that appeared after the click: ${FlowContext.newText(before, after) || '(none)'}`,
        ],
        confidence: 'ai-judgement',
      });
    }
  }

  // 2. Right password.
  if (!account) {
    ctx.skip(
      'Logging in with a correct password — ShipCheck has no test account (signing up did not finish). Give it one with --email and --password',
      { reason: 'ShipCheck had no account to log in with', action: ADVICE.account },
    );
    return;
  }
  if (ctx.page.url() !== form.url) await ctx.goto(form.url, 'Open the log-in page again');
  form = (await findForm(ctx)) ?? form;
  await ctx.perform(
    fill(form.email, account.email),
    `Type the email address into “${form.email.label}”`,
  );
  await ctx.perform(
    fill(form.password, account.password),
    `Type the correct password into “${form.password.label}”`,
  );
  const beforeRight = await ctx.snapshot();
  const rightTry = watchSubmission(ctx, [account.email]);
  await ctx.perform(click(form.submit), `Click “${form.submit.label}” with the correct password`);
  const afterRight = await rightTry.outcome(beforeRight, await ctx.snapshot());
  const passwordField = () => ctx.page.locator('input[type="password"]:visible').count();
  let loggedIn = afterRight.url !== beforeRight.url && (await passwordField()) === 0;
  let message = '';
  let confidence: 'verified' | 'ai-judgement' = 'verified';
  if (!loggedIn) {
    const outcome = await ctx.extract(PROMPTS.loginOutcome, OutcomeSchema);
    loggedIn = outcome.loggedIn && !rightTry.refused(); // the server's answer outranks the model
    // A message that already stood on the page before the click (left over from the wrong
    // password) says nothing about this attempt — unless the server refused this one too.
    const leftOver = beforeRight.text.includes(outcome.messageText.trim());
    message = rightTry.refused() || !leftOver ? outcome.messageText : '';
    confidence = 'ai-judgement';
  }
  const rightSteps = [
    `Open ${form.url}.`,
    'Type the email address and the correct password of an existing account.',
    `Click “${form.submit.label}”.`,
  ];
  if (!loggedIn && !message && rightTry.accepted()) {
    // No error on screen and the server accepted the log-in: calling this "broken" would be a
    // guess. A Blocker needs proof of failure, not missing proof of success.
    ctx.skip(
      'Logging in — the log-in was sent and the app accepted it, but ShipCheck could not confirm that the user ends up inside the app. Please check it by hand',
      {
        reason: 'the log-in was accepted, but ShipCheck could not confirm that it let the user in',
        action: ADVICE.byHand,
      },
    );
    return;
  }
  if (!loggedIn) {
    const shot = await ctx.shot('login failed');
    ctx.record({
      ...base,
      rule: 'login/fails',
      ok: false,
      title: 'Users cannot log in',
      expected: 'With the correct email address and password, the user gets into the app.',
      actual: message
        ? `The app answered: “${message}”`
        : 'The app did not let the user in and gave no clear reason.',
      severity: 'blocker',
      whyItMatters: 'Existing users are locked out of the app.',
      steps: [...rightSteps, 'You are not let in.'],
      screenshots: shot ? [shot] : [],
      logs: [
        message ? `Message on the page: ${message}` : 'No message was shown',
        ...rightTry
          .answers()
          .filter((e) => e.status >= 400)
          .slice(0, 1)
          .map((e) => `The server refused the log-in request (answer code ${e.status})`),
        `Address after submitting: ${afterRight.url}`,
      ],
      fixPrompt: `Logging in to my app fails with a correct email address and password.${message ? ` The page shows: “${message}”.` : ''} Please check the log-in request and the server logs, and fix the cause.`,
      confidence,
    });
    return;
  }
  ctx.shared.loggedIn = true;
  ctx.record({
    ...base,
    rule: 'login/works',
    ok: true,
    title: 'Logging in with the correct password works',
    expected: 'With the correct email address and password, the user gets into the app.',
    actual: `The app opened ${afterRight.url}.`,
    severity: 'info',
    whyItMatters: '',
    steps: [],
    screenshots: [],
    logs: [],
    confidence,
  });

  // 3. Still logged in after a refresh?
  const insideUrl = ctx.page.url();
  await ctx.goto(insideUrl, 'Refresh the page');
  const kicked = ctx.page.url() !== insideUrl || (await passwordField()) > 0;
  if (kicked) {
    const shot = await ctx.shot('logged out after refresh');
    ctx.record({
      ...base,
      rule: 'login/session-lost-on-refresh',
      ok: false,
      title: 'Refreshing the page logs the user out',
      expected: 'After logging in, the user stays logged in when the page is refreshed.',
      actual: `After a refresh the app showed the log-in form again (${ctx.page.url()}).`,
      severity: 'major',
      whyItMatters:
        'Users lose their place and have to log in again and again, which feels broken.',
      steps: [...rightSteps, 'Refresh the page.', 'You are asked to log in again.'],
      screenshots: shot ? [shot] : [],
      logs: [
        `Address before the refresh: ${insideUrl}`,
        `Address after the refresh: ${ctx.page.url()}`,
      ],
      url: insideUrl,
      fixPrompt:
        'In my app, users are logged out when they refresh the page. Please make the session persist across page loads (store the session in a cookie or the auth library’s persistent storage and restore it on load before deciding to show the log-in page).',
      confidence: 'verified',
    });
  } else {
    ctx.record({
      ...base,
      rule: 'login/session-survives-refresh',
      ok: true,
      title: 'Users stay logged in after refreshing the page',
      expected: 'After logging in, the user stays logged in when the page is refreshed.',
      actual: 'The app stayed on the same page after a refresh.',
      severity: 'info',
      whyItMatters: '',
      steps: [],
      screenshots: [],
      logs: [],
      confidence: 'verified',
    });
  }
};
