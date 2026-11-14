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

/**
 * Every browser in this file talks to the local fixture only. The fixture's payment widget
 * points at Stripe's addresses; without this, a plain browser would really contact them.
 */
const outsideRequests: string[] = [];
async function newContext(options: Parameters<Browser['newContext']>[0]): Promise<BrowserContext> {
  const created = await browser.newContext(options);
  await created.route('**/*', async (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === '127.0.0.1') return route.fallback();
    outsideRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return created;
}

async function open(path: string, viewport: { width: number; height: number }): Promise<Page> {
  context = await newContext({ viewport, hasTouch: viewport === PHONE });
  const page = await context.newPage();
  await page.goto(app.url + path, { waitUntil: 'load' });
  return page;
}

const overflowsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

describe('buggy-app in a real browser', () => {
  it('#11 a double click sends the contact form twice — but the newsletter form only once', async () => {
    const contact = await open('/contact.html', DESKTOP);
    await contact.getByLabel('Your name').fill('Double Click');
    const contactBefore = app.hits.contact;
    await contact.getByRole('button', { name: 'Send message' }).dblclick();
    await contact.getByText('Thanks!').waitFor();
    await contact.waitForTimeout(300);
    expect(app.hits.contact - contactBefore).toBe(2);
    await context?.close();

    const home = await open('/', DESKTOP);
    const button = home.getByRole('button', { name: 'Keep me posted' });
    const newsletterBefore = app.hits.newsletter;
    // Works on purpose: empty and invalid addresses are refused…
    await button.click();
    await home.getByLabel('Email address').fill('not-an-email');
    await button.click();
    await home.waitForTimeout(300);
    expect(app.hits.newsletter).toBe(newsletterBefore);
    // …and a double click with a valid one sends exactly one request.
    await home.getByLabel('Email address').fill('shipcheck+news@example.com');
    await button.dblclick();
    await home.getByText('You are on the list.').waitFor();
    await home.waitForTimeout(300);
    expect(app.hits.newsletter - newsletterBefore).toBe(1);
    expect(await button.isDisabled()).toBe(true);
  });

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
    context = await newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${app.url}/`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    // The payment widget's unhandled "Failed to fetch" (its request is refused here) is not
    // part of bug #3; see the payment widget test below.
    const own = errors.filter((text) => !/failed to fetch/i.test(text));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/track|analytics|undefined/);

    await page.goto(`${app.url}/contact.html`, { waitUntil: 'load' });
    expect(errors.filter((text) => !/failed to fetch/i.test(text))).toHaveLength(1);
  });

  it('payment widget (works on purpose): on load it contacts Stripe’s addresses, and only those', async () => {
    outsideRequests.length = 0;
    context = await newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const crashes: string[] = [];
    page.on('console', (m) => void (m.type() === 'error' && consoleErrors.push(m.text())));
    page.on('pageerror', (error) => crashes.push(error.message));
    await page.goto(`${app.url}/`, { waitUntil: 'load' });
    await expect.poll(() => outsideRequests.length).toBe(3);
    expect(outsideRequests.map((url) => new URL(url).hostname).sort()).toEqual([
      'api.stripe.com',
      'js.stripe.com',
      'r.stripe.com',
    ]);
    expect(app.requests).toContain('GET /assets/pay-widget.js');
    // Its own reactions to the refused requests, which ShipCheck must not report:
    await expect
      .poll(() =>
        consoleErrors.some((t) => t.startsWith('PayWidget: could not reach r.stripe.com')),
      )
      .toBe(true);
    await expect.poll(() => crashes.some((t) => /failed to fetch/i.test(t))).toBe(true);
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
      context = await newContext({ viewport: DESKTOP });
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
