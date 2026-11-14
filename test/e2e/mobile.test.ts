import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MOBILE } from '../../src/browser/devices.js';
import { Evidence } from '../../src/browser/evidence.js';
import { BrowserSession, type DevicePage } from '../../src/browser/session.js';
import { collectLayoutFacts } from '../../src/checks/mobile-layout.js';
import { checkPhoneMenu } from '../../src/checks/mobile-menu.js';
import { startFixtureServer, type FixtureServer } from '../helpers/fixture-server.js';

/**
 * The phone layout and menu checks in a real phone-sized browser (390×844, touch, mobile user
 * agent). Synthetic pages cover each rule and each exception; the fixture covers bug #8.
 */
let app: FixtureServer;
let session: BrowserSession;
let evidence: Evidence;
let phone: DevicePage;

beforeAll(async () => {
  app = await startFixtureServer();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  evidence = new Evidence();
  session = await BrowserSession.launch({ targetUrl: app.url, evidence });
  phone = await session.open(MOBILE);
  await phone.page.goto(`${app.url}/contact.html`); // a real page of the app, then replaced
});
afterEach(async () => {
  await session.close();
});

const show = async (body: string, style = '') => {
  await phone.page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px sans-serif}${style}</style></head><body>${body}</body></html>`,
  );
  return collectLayoutFacts(phone.page);
};

describe('phone layout facts', () => {
  it('bug #8: the fixture features page is wider than the phone, caused by the 900px table', async () => {
    await phone.page.goto(`${app.url}/features.html`);
    const facts = await collectLayoutFacts(phone.page);
    expect(facts.screenWidth).toBe(390);
    expect(facts.pageWidth).toBeGreaterThan(900);
    expect(facts.widest).toMatchObject({ tag: 'table.plans', width: 900 });
    expect(facts.cutOff).toEqual([]); // nothing is hidden: the owner's "Minor" decision
  });

  it('the other fixture pages fit a phone and have no crowded, covered or cut-off buttons', async () => {
    for (const path of ['/', '/signup.html', '/login.html', '/contact.html', '/dashboard.html']) {
      await phone.page.goto(app.url + path);
      const facts = await collectLayoutFacts(phone.page);
      expect(facts.pageWidth, path).toBeLessThanOrEqual(facts.screenWidth + 1);
      expect([facts.cutOff, facts.covered, facts.tooSmall], path).toEqual([[], [], []]);
      expect(facts.controls, path).toBeGreaterThan(0);
    }
  });

  it('a button pushed past the right edge (sideways scrolling switched off) is cut off', async () => {
    const facts = await show(
      '<header><nav class="row"><a class="btn" href="/a">Features</a><a class="btn" href="/b">Pricing</a><button class="btn">Sign up</button></nav></header>',
      'body{overflow-x:hidden}.row{display:flex;flex-wrap:nowrap}.btn{flex:0 0 180px;padding:12px}',
    );
    expect(facts.cutOff.map((c) => c.label)).toEqual(['Sign up']);
  });

  it('a closed drawer menu parked off-screen and a sideways carousel are not “cut off”', async () => {
    const facts = await show(
      `<nav class="drawer"><a href="/a">Home</a><a href="/b">Pricing</a></nav>
       <div class="carousel"><button>One</button><button>Two</button><button>Three</button></div>`,
      `.drawer{position:fixed;top:0;left:0;width:280px;transform:translateX(-100%)}
       .carousel{display:flex;overflow-x:auto}.carousel button{flex:0 0 200px;height:44px}`,
    );
    expect(facts.cutOff).toEqual([]);
    expect(facts.pageWidth).toBeLessThanOrEqual(391);
  });

  it('a button under a fixed banner is covered; a button holding an icon is not', async () => {
    const facts = await show(
      `<main><button style="display:block;width:60px;height:48px"><svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg></button>
       <button style="display:block;margin-top:700px;width:200px;height:48px">Buy now</button></main>
       <div class="chat">Chat with us</div>`,
      '.chat{position:fixed;bottom:0;left:0;right:0;height:180px;background:#eee}',
    );
    expect(facts.covered.map((c) => [c.control.label, c.by])).toEqual([
      ['Buy now', 'Chat with us (div.chat)'],
    ]);
  });

  it('WCAG 2.5.8: crowded 16px buttons fail; a lone 16px button with space and text links pass', async () => {
    const facts = await show(
      `<div><button class="tiny">a</button><button class="tiny">b</button></div>
       <div style="margin-top:80px"><button class="tiny">lonely</button></div>
       <p>Read our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>
       <button style="width:44px;height:44px">ok</button>`,
      '.tiny{width:16px;height:16px;padding:0;border:0;margin:0;font-size:8px;overflow:hidden}',
    );
    expect(facts.tooSmall.map((c) => [c.label, c.width, c.height])).toEqual([
      ['a', 16, 16],
      ['b', 16, 16],
    ]);
  });
});

describe('phone menu button', () => {
  const MENU = `<header><button class="menu-toggle" aria-label="Menu" aria-expanded="false">☰</button>
    <nav id="nav" hidden><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/signup">Sign up</a></nav></header>`;

  it('a menu that opens → passed, and the tap is in the action log', async () => {
    await show(
      `${MENU}<script>document.querySelector('.menu-toggle').addEventListener('click', (e) => {
        document.getElementById('nav').hidden = false; e.currentTarget.setAttribute('aria-expanded', 'true'); });</script>`,
    );
    const result = await checkPhoneMenu(phone.page, { device: 'mobile', evidence });
    expect(result).toEqual({ findings: [], passed: ['The menu opens on a phone'], notTested: [] });
    expect(evidence.actionLog.map((a) => [a.intent, a.result])).toEqual([
      ['Tap the menu button “Menu”', 'ok'],
    ]);
  });

  it('a menu button that does nothing → Major “menu does not open”, with before/after screenshots', async () => {
    await show(MENU);
    const result = await checkPhoneMenu(phone.page, { device: 'mobile', evidence });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: 'mobile/menu-does-not-open',
      title: 'The menu does not open on a phone',
      severity: 'major',
      device: 'mobile',
    });
    expect(result.findings[0]?.evidence.screenshots).toHaveLength(2);
  });

  it('a “menu” button that would delete something is never tapped (the guard refuses it)', async () => {
    await show(
      `<header><button aria-label="Delete account" aria-expanded="false" onclick="document.title='clicked'">⋯</button></header>`,
    );
    const result = await checkPhoneMenu(phone.page, { device: 'mobile', evidence });
    expect(result.findings).toEqual([]);
    expect(result.notTested[0]).toMatch(/^The phone menu — ShipCheck did not tap “Delete account”/);
    expect(await phone.page.title()).not.toBe('clicked');
    expect(evidence.actionLog.map((a) => a.result)).toEqual(['blocked']);
  });

  it('no menu button (links shown directly) → nothing to check', async () => {
    await phone.page.goto(`${app.url}/`);
    expect(await checkPhoneMenu(phone.page, { device: 'mobile', evidence })).toEqual({
      findings: [],
      passed: [],
      notTested: [],
    });
  });
});
