import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DESKTOP, MOBILE, USER_AGENT_SUFFIX } from '../../src/browser/devices.js';
import { BrowserSession, type DevicePage } from '../../src/browser/session.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * The domain lock in a real browser (SPEC §7.1). "outside" is a second local server standing
 * in for another website: it must never receive a page navigation from the locked browser.
 */
let app: FixtureServer;
let outside: FixtureServer;
let session: BrowserSession;
let desktop: DevicePage;

beforeAll(async () => {
  app = await startFixtureServer();
  outside = await startFixtureServer();
  session = await BrowserSession.launch({ targetUrl: app.url });
  desktop = await session.open(DESKTOP);
});

afterAll(async () => {
  await session.close();
  await app.close();
  await outside.close();
});

const settle = () => desktop.page.waitForTimeout(400);
const blocked = () =>
  session.evidence.events.flatMap((e) => (e.kind === 'blocked-navigation' ? [e.url] : []));

describe('domain lock in a real browser', () => {
  it('allows navigation inside the tested app', async () => {
    await desktop.page.goto(`${app.url}/`);
    await desktop.page.getByRole('link', { name: 'Features' }).click();
    await desktop.page.waitForURL('**/features.html');
  });

  it('blocks a direct navigation to another site and stays on the current page', async () => {
    await desktop.page.goto(`${app.url}/contact.html`);
    await expect(desktop.page.goto(`${outside.url}/direct`)).rejects.toThrow();
    await settle();
    expect(desktop.page.url()).toBe(`${app.url}/contact.html`);
    await expect(desktop.page.locator('h1').textContent()).resolves.toBe('Contact us');
    expect(blocked()).toContain(`${outside.url}/direct`);
  });

  it('blocks a clicked link, a new-tab link, a popup and a script redirect', async () => {
    await desktop.page.goto(`${app.url}/contact.html`);
    await desktop.page.evaluate(`(() => {
      const add = (id, href, target) => {
        const a = document.createElement('a');
        a.id = id; a.href = href; a.textContent = id;
        if (target) a.target = target;
        document.querySelector('main').prepend(a);
      };
      add('same-tab', '${outside.url}/clicked');
      add('new-tab', '${outside.url}/new-tab', '_blank');
    })()`);

    await desktop.page.click('#same-tab');
    await settle();
    await desktop.page.click('#new-tab');
    await settle();
    await desktop.page.evaluate(`window.open('${outside.url}/popup')`);
    await settle();
    await desktop.page.evaluate(
      `setTimeout(() => { location.href = '${outside.url}/redirect'; }, 0)`,
    );
    await settle();

    expect(desktop.page.url()).toBe(`${app.url}/contact.html`);
    expect(blocked()).toEqual(
      expect.arrayContaining(
        ['/clicked', '/new-tab', '/popup', '/redirect'].map((p) => outside.url + p),
      ),
    );
  });

  it('still lets the app load things from other sites in the background', async () => {
    await desktop.page.goto(`${app.url}/contact.html`);
    const before = outside.requests.length;
    await desktop.page.evaluate(`(() => {
      const img = new Image();
      img.src = '${outside.url}/favicon.svg';
      const frame = document.createElement('iframe');
      frame.src = '${outside.url}/features.html';
      document.body.append(img, frame);
    })()`);
    await settle();
    expect(outside.requests.slice(before)).toEqual(
      expect.arrayContaining(['GET /favicon.svg', 'GET /features.html']),
    );
  });

  it('the other site never received a top-level page navigation', () => {
    const pagesRequested = outside.requests.filter((r) =>
      /\/(direct|clicked|new-tab|popup|redirect)$/.test(r),
    );
    expect(pagesRequested).toEqual([]);
  });

  it('dismisses "Are you sure?" dialogs instead of accepting them', async () => {
    await desktop.page.goto(`${app.url}/contact.html`);
    const answer = await desktop.page.evaluate(`confirm('Really delete everything?')`);
    expect(answer).toBe(false);
    expect(
      session.evidence.events.some(
        (e) => e.kind === 'dialog' && e.text === 'Really delete everything?',
      ),
    ).toBe(true);
  });

  it('the phone context is locked too, with a phone-sized screen and identified user agent', async () => {
    const phone = await session.open(MOBILE);
    await phone.page.goto(`${app.url}/`);
    const facts = await phone.page.evaluate(
      `({ width: innerWidth, ua: navigator.userAgent, touch: 'ontouchstart' in window })`,
    );
    expect(facts).toMatchObject({ width: 390, touch: true });
    expect((facts as { ua: string }).ua).toMatch(/iPhone/);
    expect((facts as { ua: string }).ua).toContain(USER_AGENT_SUFFIX);

    const before = outside.requests.length;
    await expect(phone.page.goto(`${outside.url}/from-phone`)).rejects.toThrow();
    expect(outside.requests.slice(before)).toEqual([]);
    await phone.context.close();
  });
});
