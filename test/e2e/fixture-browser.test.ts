import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNT, startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * Proves in a real browser that the planted bugs behave as BUGS.md says — and that the
 * "works on purpose" parts really work. If this fails, the fixture is wrong, not ShipCheck.
 */
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

let app: FixtureServer;
let browser: Browser;
let context: BrowserContext | undefined;

beforeAll(async () => {
  app = await startFixtureServer();
  browser = await chromium.launch();
});

afterEach(async () => {
  await context?.close();
  context = undefined;
});

afterAll(async () => {
  await browser.close();
  await app.close();
});

async function open(path: string, viewport: { width: number; height: number }): Promise<Page> {
  context = await browser.newContext({ viewport, hasTouch: viewport === PHONE });
  const page = await context.newPage();
  await page.goto(app.url + path, { waitUntil: 'load' });
  return page;
}

const overflowsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

describe('buggy-app in a real browser', () => {
  it('#1 signup works on desktop but the button does nothing on a phone', async () => {
    const account = { email: 'shipcheck+desktop@example.com', password: 'longenough1' };

    const desktop = await open('/signup.html', DESKTOP);
    await desktop.getByLabel('Email').fill(account.email);
    await desktop.getByLabel('Password').fill(account.password);
    await desktop.getByRole('button', { name: 'Create account' }).click();
    await desktop.waitForURL('**/dashboard.html');
    await context?.close();

    const signupsBefore = app.hits.signup;
    const phone = await open('/signup.html', PHONE);
    await phone.getByLabel('Email').fill('shipcheck+phone@example.com');
    await phone.getByLabel('Password').fill(account.password);
    await phone.getByRole('button', { name: 'Create account' }).click();
    await phone.waitForTimeout(500);
    expect(phone.url()).toContain('/signup.html');
    expect(app.hits.signup).toBe(signupsBefore);
  });

  it('#3 landing page throws an uncaught error on load; other pages do not', async () => {
    context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${app.url}/`, { waitUntil: 'load' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/track|analytics|undefined/);

    await page.goto(`${app.url}/contact.html`, { waitUntil: 'load' });
    expect(errors).toHaveLength(1);
  });

  it('#7 wrong password shows no message; the right password logs in', async () => {
    const page = await open('/login.html', DESKTOP);
    await page.getByLabel('Email').fill(DEMO_ACCOUNT.email);
    await page.getByLabel('Password').fill('definitely-wrong');
    const rejected = page.waitForResponse((r) => r.url().endsWith('/api/login'));
    await page.getByRole('button', { name: 'Log in' }).click();
    expect((await rejected).status()).toBe(401);
    await page.waitForTimeout(300);
    expect(page.url()).toContain('/login.html');
    expect((await page.locator('#login-message').textContent())?.trim()).toBe('');

    await page.getByLabel('Password').fill(DEMO_ACCOUNT.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL('**/dashboard.html');
  });

  it('#8 only the features page scrolls sideways on a phone, and not on desktop', async () => {
    const phone = await open('/features.html', PHONE);
    expect(await overflowsSideways(phone)).toBe(true);
    for (const path of ['/', '/signup.html', '/login.html', '/contact.html', '/dashboard.html']) {
      await phone.goto(app.url + path, { waitUntil: 'load' });
      expect(await overflowsSideways(phone), `${path} should fit a phone`).toBe(false);
    }
    await context?.close();

    const desktop = await open('/features.html', DESKTOP);
    expect(await overflowsSideways(desktop)).toBe(false);
  });

  it('main feature works: a note is added and survives a refresh', async () => {
    const page = await open('/dashboard.html', DESKTOP);
    await page.getByLabel('New note').fill('Buy oat milk');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect.poll(() => page.getByRole('listitem').allTextContents()).toEqual(['Buy oat milk']);
    await page.reload();
    expect(await page.getByRole('listitem').allTextContents()).toEqual(['Buy oat milk']);
  });

  it('#9 and #10 traps are live: clicking them reaches the server counters', async () => {
    // A separate server so these deliberate clicks never pollute other counters.
    const trap = await startFixtureServer();
    try {
      context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();

      await page.goto(`${trap.url}/account.html`);
      expect(trap.hits.deleteAccount).toBe(0);
      await page.getByRole('button', { name: 'Delete account' }).click();
      await expect.poll(() => trap.hits.deleteAccount).toBe(1);

      await page.goto(`${trap.url}/checkout.html`);
      await expect(page.locator('input[autocomplete="cc-number"]').count()).resolves.toBe(1);
      await page.getByRole('button', { name: 'Pay €9 now' }).click();
      await expect.poll(() => trap.hits.checkoutSubmit).toBe(1);
      expect(trap.hits.cardDataReceived).toBe(0);
    } finally {
      await trap.close();
    }
  });
});
