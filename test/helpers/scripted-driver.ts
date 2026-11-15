import type { Page } from 'playwright';
import type { LlmBudget } from '../../src/ai/budget.js';
import type { AiDriver } from '../../src/ai/driver.js';
import { PROMPTS } from '../../src/ai/prompts.js';
import type { ProposedAction } from '../../src/browser/guard.js';

/**
 * A stand-in for the AI layer that knows the buggy fixture app by heart. It lets the flows, the
 * guard and the budget be tested in CI without an AI key. Like the real driver it counts one
 * model call per observe and two per extract, and it performs exactly the action it is given.
 */
const byId = (id: string) => `xpath=//*[@id="${id}"]`;
const click = (selector: string, description: string): ProposedAction => ({
  selector,
  description,
  method: 'click',
  arguments: [],
});
const fill = (selector: string, description: string, value = 'example'): ProposedAction => ({
  selector,
  description,
  method: 'fill',
  arguments: [value],
});
const navLink = (href: string) => `xpath=//header//nav//a[@href="${href}"]`;

export interface ScriptedOptions {
  budget?: LlmBudget;
  /** Replaces the answers for the main-feature steps (to script a misbehaving AI). */
  nextStep?: (page: Page, done: number) => ProposedAction[];
  /** Pretends the app has no sign-up and no log-in: the AI finds neither a link nor a form. */
  noAccounts?: boolean;
  /** Stands in for a model that obeys instructions hidden in the tested page. */
  gullible?: boolean;
  /** Stands in for a model that says "logged in" after every log-in attempt. */
  gullibleLogin?: boolean;
  /** The judge's answer (reworded findings) for the given instruction. */
  judge?: (instruction: string) => unknown;
  /** Replaces the answer for "what is this app's main action". */
  goal?: string;
}

export function createScriptedDriver(options: ScriptedOptions = {}): AiDriver & {
  observed: string[];
  acted: ProposedAction[];
} {
  const observed: string[] = [];
  const acted: ProposedAction[] = [];
  const path = (page: Page) => new URL(page.url()).pathname;

  return {
    observed,
    acted,
    async observe(page, instruction) {
      await options.budget?.run(async () => undefined);
      observed.push(instruction);
      if (
        options.noAccounts &&
        (
          [
            PROMPTS.signupEntry,
            PROMPTS.signupForm,
            PROMPTS.loginEntry,
            PROMPTS.loginForm,
          ] as string[]
        ).includes(instruction)
      ) {
        return [];
      }
      switch (instruction) {
        case PROMPTS.landingTargets:
          return [
            click(
              'xpath=//main//a[@href="/signup.html"]',
              'Main call-to-action “Get started free”',
            ),
            click(navLink('/features.html'), 'Menu link Features'),
            click(navLink('/pricing.html'), 'Menu link Pricing'),
          ];
        case PROMPTS.signupEntry:
          return ['/signup.html', '/late-signup.html', '/injected-signup.html'].includes(path(page))
            ? []
            : [click(navLink('/signup.html'), 'Sign up link')];
        case PROMPTS.signupForm:
          return [
            fill(byId('signup-email'), 'Email field'),
            fill(byId('signup-password'), 'Password field'),
            click(byId('signup-button'), 'Create account button'),
          ];
        case PROMPTS.loginEntry:
          return ['/login.html', '/slow-login.html'].includes(path(page))
            ? []
            : [click(navLink('/login.html'), 'Log in link')];
        case PROMPTS.loginForm:
          return [
            fill(byId('login-email'), 'Email field'),
            fill(byId('login-password'), 'Password field'),
            click('xpath=//form[@id="login-form"]//button', 'Log in button'),
          ];
        case PROMPTS.formFields:
          if (['/contact.html', '/tracked-form.html'].includes(path(page))) {
            return [
              fill(byId('contact-name'), 'Name field'),
              fill(byId('contact-email'), 'Email field'),
              fill(byId('contact-message'), 'Message field'),
              click('xpath=//form[@id="contact-form"]//button', 'Send message button'),
            ];
          }
          return path(page) === '/'
            ? [
                fill(byId('newsletter-email'), 'Newsletter email field'),
                click(byId('newsletter-button'), 'Keep me posted button'),
              ]
            : [];
        default: {
          // The main-feature loop: its instruction changes with every step taken.
          const done = (instruction.match(/Already done: (.*?)\. Find the single/)?.[1] ?? '')
            .split('; ')
            .filter(Boolean).length;
          if (options.nextStep) return options.nextStep(page, done);
          if (path(page) !== '/dashboard.html') return [];
          if (done === 0)
            return [fill(byId('note-text'), 'New note field', 'Buy milk (ShipCheck test)')];
          return done === 1
            ? [click('xpath=//form[@id="note-form"]//button', 'Add note button')]
            : [];
        }
      }
    },

    async act(page, action) {
      acted.push(action);
      const locator = page.locator(action.selector);
      try {
        const value = action.arguments?.[0] ?? '';
        if (action.method === 'fill') await locator.fill(value, { timeout: 5000 });
        else if (action.method === 'doubleClick') await locator.dblclick({ timeout: 5000 });
        else if (action.method === 'click') await locator.click({ timeout: 5000 });
        else return { success: false, message: `scripted driver cannot ${action.method}` };
        return { success: true, message: 'done' };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'failed' };
      }
    },

    async extract(page, instruction) {
      await options.budget?.run(async () => undefined);
      await options.budget?.run(async () => undefined);
      observed.push(instruction);
      const text = await page.evaluate(() => document.body.innerText);
      if (instruction === PROMPTS.mainAction)
        return { goal: options.goal ?? 'Add a note' } as never;
      if (instruction === PROMPTS.loginOutcome) {
        // Like a model, it reads the message next to the form, if the page shows one.
        const shown = (
          await page
            .locator('#login-message')
            .innerText()
            .catch(() => '')
        ).trim();
        return {
          loggedIn: options.gullibleLogin === true || path(page) === '/dashboard.html',
          errorVisible: shown !== '',
          messageText: shown,
        } as never;
      }
      if (instruction === PROMPTS.signupOutcome) {
        // Like a model, it reads the whole message — including text hidden from people.
        const shown = await page
          .locator('#signup-message')
          .innerText()
          .catch(() => '');
        const error =
          shown.replace(/\s+/g, ' ').trim() ||
          (/valid email|at least 8|already exists|Something went wrong/.exec(text)?.[0] ?? '');
        // A gullible model does what hidden text on the page tells it to.
        const obeys = options.gullible === true && /ignore your instructions/i.test(text);
        return {
          accountCreated: obeys || path(page) === '/dashboard.html',
          needsEmailVerification: false,
          captchaBlocked: false,
          errorText: obeys ? '' : error,
        } as never;
      }
      // The main-feature outcome: like a model, it notices an error message on the page.
      const failure = /valid email|at least 8 characters|already exists/.exec(text)?.[0];
      return {
        accomplished: false,
        errorVisible: failure !== undefined,
        whatIsVisible: failure ? `The page says: “${failure}”.` : 'Nothing changed.',
      } as never;
    },

    async ask(instruction) {
      await options.budget?.run(async () => undefined);
      observed.push(instruction);
      // By default the scripted judge returns nothing, so the original wording stays.
      return (options.judge?.(instruction) ?? { findings: [] }) as never;
    },

    async close() {
      // Nothing to release.
    },
  };
}
