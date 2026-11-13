import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmBudget } from '../../src/ai/budget.js';
import { DESKTOP } from '../../src/browser/devices.js';
import { Evidence } from '../../src/browser/evidence.js';
import { BrowserSession, type DevicePage } from '../../src/browser/session.js';
import { loadConfig } from '../../src/config.js';
import { StopFlow, runFlow } from '../../src/flows/context.js';
import type { FlowDeps } from '../../src/flows/types.js';
import { createScriptedDriver } from '../helpers/scripted-driver.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * SPEC §7.2 / §7.3 in a real browser. Two independent layers are proven separately:
 *  - the BACKSTOP, with no guard and no flow logic at all (plain browser clicks), and
 *  - the GUARD, which refuses the action before the browser is touched.
 */
let app: FixtureServer;
let session: BrowserSession;
let evidence: Evidence;
let desktop: DevicePage;

beforeAll(async () => {
  app = await startFixtureServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  evidence = new Evidence();
  session = await BrowserSession.launch({ targetUrl: app.url, evidence });
  desktop = await session.open(DESKTOP);
  for (const key of Object.keys(app.hits) as (keyof typeof app.hits)[]) app.hits[key] = 0;
});
afterEach(async () => {
  await session.close();
});

const blocked = () =>
  evidence.events.flatMap((e) =>
    e.kind === 'blocked-request' ? [`${e.method} ${new URL(e.url).pathname}: ${e.reason}`] : [],
  );
const TRAPS_UNTOUCHED = { deleteAccount: 0, checkoutSubmit: 0, cardDataReceived: 0 };

describe('backstop alone — no guard, no flow logic, just a browser that clicks', () => {
  it('"Delete account" is clicked, and the delete request never reaches the server', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/account.html`);
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.waitForTimeout(500);
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
    expect(blocked()).toEqual([
      'POST /api/delete-account: a request that could delete data, cancel something or start a payment',
    ]);
  });

  it('card details are typed and "Pay" is clicked, and nothing reaches the server', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/checkout.html`);
    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await page.getByLabel('Expiry date').fill('12 / 30');
    await page.getByLabel('Security code').fill('123');
    await page.getByRole('button', { name: /Pay/ }).click();
    await page.waitForTimeout(500);
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
    expect(blocked()).toEqual(['POST /api/checkout: a request that contained a card number']);
  });

  it('"Pay" with an empty card field is stopped as well', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/checkout.html`);
    await page.getByRole('button', { name: /Pay/ }).click();
    await page.waitForTimeout(500);
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
    expect(blocked()).toHaveLength(1);
  });

  it('a card number is stopped even in a harmless-looking request to the app itself', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/contact.html`);
    await page.getByLabel('Message').fill('my card is 5555-5555-5555-4444');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.waitForTimeout(500);
    expect(app.hits.contact).toBe(0);
    expect(blocked()).toEqual(['POST /api/contact: a request that contained a card number']);
  });

  it('requests to a payment provider are stopped inside the browser', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/`);
    const outcome = await page.evaluate(() =>
      fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        body: 'amount=900',
      }).then(
        () => 'sent',
        () => 'stopped',
      ),
    );
    expect(outcome).toBe('stopped');
    expect(blocked()).toEqual(['POST /v1/payment_intents: a request to a payment provider']);
  });

  it('"Are you sure?" boxes are always answered with No, and alerts do not hang the run', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/account.html`);
    const confirmed = await page.evaluate(() => window.confirm('Really delete everything?'));
    expect(confirmed).toBe(false);
    await page.evaluate(() => window.alert('Saved!'));
    expect(await page.evaluate(() => window.prompt('Type DELETE to confirm'))).toBeNull();
    expect(evidence.events.filter((e) => e.kind === 'dialog')).toHaveLength(3);
  });

  it('does not get in the way of ordinary use: a normal form still goes through', async () => {
    const { page } = desktop;
    await page.goto(`${app.url}/contact.html`);
    await page.getByLabel('Your name').fill('ShipCheck Tester');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByText('Thanks!').waitFor();
    expect(app.hits.contact).toBe(1);
    expect(blocked()).toEqual([]);
  });
});

describe('guard — refuses before the browser is touched', () => {
  const deps = (guardEnabled: boolean, driver = createScriptedDriver()): FlowDeps => ({
    page: desktop.page,
    device: 'desktop',
    config: loadConfig(app.url, { yes: true }, {}),
    ai: driver,
    evidence,
    budget: new LlmBudget({ deadline: Date.now() + 60_000 }),
    deadline: Date.now() + 60_000,
    shared: { loggedIn: false },
    homeUrl: `${app.url}/`,
    guardEnabled,
  });
  const deleteButton = {
    selector: 'xpath=//*[@id="delete-account"]',
    description: 'A harmless looking button', // the AI's words do not matter
    method: 'click',
    arguments: [],
  };

  it('guard on: "Delete account" is refused, logged as blocked, and never clicked', async () => {
    const driver = createScriptedDriver();
    const result = await runFlow('core', deps(true, driver), async (ctx) => {
      await ctx.goto(`${app.url}/account.html`, 'Open account settings');
      const verdict = await ctx.perform(deleteButton, 'Click the button');
      expect(verdict).toMatchObject({ status: 'blocked' });
      expect(verdict.status === 'blocked' && verdict.reason).toMatch(/delete or cancel.*“Delete”/);
      // A harmless button on the same page is still allowed.
      const save = await ctx.perform(
        {
          selector: 'xpath=//*[@id="save-profile"]',
          description: 'Save',
          method: 'click',
          arguments: [],
        },
        'Save the profile',
      );
      expect(save.status).toBe('ok');
    });
    expect(result.status).toBe('completed');
    expect(driver.acted.map((a) => a.selector)).toEqual(['xpath=//*[@id="save-profile"]']);
    expect(evidence.actionLog.map((a) => `${a.action} ${a.result}`)).toEqual([
      'goto ok',
      'click blocked',
      'click ok',
    ]);
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
    expect(blocked()).toEqual([]); // the backstop was not even needed
  });

  it('guard on: an element that cannot be read is refused (fail closed)', async () => {
    const driver = createScriptedDriver();
    await runFlow('core', deps(true, driver), async (ctx) => {
      await ctx.goto(`${app.url}/account.html`, 'Open account settings');
      const verdict = await ctx.perform(
        { selector: 'xpath=//button', description: 'some button', method: 'click', arguments: [] },
        'Click a button that matches two elements',
      );
      expect(verdict).toMatchObject({ status: 'blocked' });
    });
    expect(driver.acted).toEqual([]);
  });

  it('guard OFF: the click happens, the backstop stops the request, the flow ends', async () => {
    const driver = createScriptedDriver();
    let stop: unknown;
    const result = await runFlow('core', deps(false, driver), async (ctx) => {
      await ctx.goto(`${app.url}/account.html`, 'Open account settings');
      await ctx.perform(deleteButton, 'Click the button').catch((error: unknown) => {
        stop = error;
        throw error;
      });
    });
    expect(driver.acted.map((a) => a.selector)).toEqual([deleteButton.selector]); // really clicked
    expect(stop).toBeInstanceOf(StopFlow);
    expect(result.status).toBe('stopped');
    expect(result.notTested[0]).toMatch(/stopped by design.*ShipCheck blocked it/);
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
    expect(blocked()).toHaveLength(1);
  });

  it('a payment page stops the flow with the Info note, before anything is typed', async () => {
    const driver = createScriptedDriver();
    const result = await runFlow('core', deps(true, driver), async (ctx) => {
      await ctx.goto(`${app.url}/checkout.html`, 'Open the upgrade page');
      await ctx.perform(
        {
          selector: 'xpath=//*[@id="card-number"]',
          description: 'Card',
          method: 'fill',
          arguments: ['4242424242424242'],
        },
        'Type a card number',
      );
    });
    expect(result.status).toBe('stopped');
    expect(result.observations.map((o) => [o.rule, o.severity, o.title])).toEqual([
      ['coverage/reached-payment', 'info', 'Reached payment — stopped by design'],
    ]);
    expect(result.observations[0]?.screenshots).toHaveLength(1);
    expect(driver.acted).toEqual([]);
    expect(await desktop.page.inputValue('#card-number')).toBe('');
    expect(app.hits).toMatchObject(TRAPS_UNTOUCHED);
  });

  it('stops a flow after 25 steps', async () => {
    const result = await runFlow('core', deps(true), async (ctx) => {
      await ctx.goto(`${app.url}/account.html`, 'Open account settings');
      for (let i = 0; i < 40; i += 1) {
        await ctx.perform(
          {
            selector: 'xpath=//*[@id="save-profile"]',
            description: 'Save',
            method: 'click',
            arguments: [],
          },
          'Save again',
        );
      }
    });
    expect(result.status).toBe('stopped');
    expect(result.steps).toBe(25);
    expect(result.notTested[0]).toMatch(/stopped after 25 steps/);
  });
});
