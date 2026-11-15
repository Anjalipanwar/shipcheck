import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DESKTOP, MOBILE } from '../../src/browser/devices.js';
import { Evidence } from '../../src/browser/evidence.js';
import { BrowserSession, type DevicePage } from '../../src/browser/session.js';
import { dismissCoveringBanners } from '../../src/checks/mobile-banner.js';
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

describe('covered buttons: close the banner with a safe choice first (owner, 2026-11-15)', () => {
  const SIGN_UP =
    '<main><button style="display:block;margin:700px 16px 0;width:200px;height:48px">Sign up</button></main>';
  const BAR = (buttons: string, extra = '') =>
    `${SIGN_UP}<div class="cookie-bar">${extra}<p>We use cookies to improve your visit.</p>${buttons}</div>
     <script>for (const b of document.querySelectorAll('.cookie-bar button')) b.addEventListener('click', () => {
       document.title = 'tapped: ' + b.textContent;
       if (b.dataset.closes) document.querySelector('.cookie-bar').remove(); });</script>`;
  const STYLE =
    '.cookie-bar{position:fixed;bottom:0;left:0;right:0;height:220px;background:#eee;padding:8px}.cookie-bar button{min-height:44px;margin:4px}';
  const dismiss = (facts: Awaited<ReturnType<typeof show>>, guardEnabled = true) =>
    dismissCoveringBanners(phone.page, facts, {
      device: 'mobile',
      evidence,
      ...(guardEnabled ? {} : { guardEnabled: false }),
    });

  it('“Reject all” is tapped (never “Accept all”); the button is reachable afterwards → closedWith', async () => {
    const facts = await show(
      BAR('<button data-closes="1">Accept all</button><button data-closes="1">Reject all</button>'),
      STYLE,
    );
    expect(facts.covered).toHaveLength(1);
    expect(facts.covered[0]).toMatchObject({
      control: { label: 'Sign up' },
      cover: expect.stringMatching(/^xpath=\/html\[1\]\/body\[1\]\/div\[1\]$/),
      coverText: expect.stringContaining('We use cookies'),
    });
    const judged = await dismiss(facts);
    expect(judged.covered[0]?.closedWith).toBe('Reject all');
    expect(await phone.page.title()).toBe('tapped: Reject all');
    expect(evidence.actionLog.map((a) => [a.intent, a.result])).toEqual([
      ['Close the banner covering a button (“Reject all”)', 'ok'],
    ]);
  });

  it('only “Accept all” on the banner → nothing is tapped, the button stays covered', async () => {
    const facts = await show(BAR('<button data-closes="1">Accept all</button>'), STYLE);
    const judged = await dismiss(facts, false); // even with the guard off, consent is never given
    expect(judged).toEqual(facts);
    expect(judged.covered[0]?.closedWith).toBeUndefined();
    expect(await phone.page.title()).toBe('');
    expect(evidence.actionLog).toEqual([]);
  });

  it('a “Close” button that does not close the banner → tapped once, still covered', async () => {
    const facts = await show(
      BAR('<button>Close</button><button data-closes="1">Accept all</button>'),
      STYLE,
    );
    const judged = await dismiss(facts);
    expect(await phone.page.title()).toBe('tapped: Close');
    expect(judged.covered[0]?.closedWith).toBeUndefined();
    expect(evidence.actionLog.map((a) => a.result)).toEqual(['ok']);
  });

  it('the guard still has the last word: a “Close” button inside a payment form is not tapped', async () => {
    const facts = await show(
      BAR(
        '',
        '<form><input name="cardnumber" aria-label="Card number"><button data-closes="1" type="button">Close</button></form>',
      ),
      STYLE,
    );
    const judged = await dismiss(facts);
    expect(judged.covered[0]?.closedWith).toBeUndefined();
    expect(await phone.page.title()).toBe('');
    expect(evidence.actionLog.map((a) => a.result)).toEqual(['blocked']);
  });

  it('a button covered by the normal layout (no fixed banner) → nothing to close', async () => {
    const facts = await show(
      `<main><button style="display:block;width:200px;height:48px">Sign up</button>
       <div style="margin-top:-48px;height:60px;background:#eee;position:relative">Promo</div></main>`,
    );
    expect(facts.covered.map((c) => [c.control.label, c.cover])).toEqual([['Sign up', null]]);
    expect(await dismiss(facts)).toEqual(facts);
    expect(evidence.actionLog).toEqual([]);
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

  it('fixture: /menu-ok.html — the menu opens on a phone (must not be reported)', async () => {
    await phone.page.goto(`${app.url}/menu-ok.html`);
    const facts = await collectLayoutFacts(phone.page);
    expect([facts.cutOff, facts.covered, facts.tooSmall]).toEqual([[], [], []]);
    expect(facts.pageWidth).toBeLessThanOrEqual(facts.screenWidth + 1);
    const result = await checkPhoneMenu(phone.page, { device: 'mobile', evidence });
    expect(result).toEqual({ findings: [], passed: ['The menu opens on a phone'], notTested: [] });
  });

  it('fixture: /menu-broken.html — planted bug #12, the menu does not open on a phone', async () => {
    await phone.page.goto(`${app.url}/menu-broken.html`);
    const facts = await collectLayoutFacts(phone.page);
    expect([facts.cutOff, facts.covered, facts.tooSmall]).toEqual([[], [], []]);
    const result = await checkPhoneMenu(phone.page, { device: 'mobile', evidence });
    expect(result.findings.map((f) => [f.rule, f.severity, f.device])).toEqual([
      ['mobile/menu-does-not-open', 'major', 'mobile'],
    ]);
    expect(result.findings[0]?.whatHappened).toContain('“Menu”');
  });

  it('fixture: on a desktop both menu pages show their links and no menu button', async () => {
    const desktop = await session.open(DESKTOP);
    for (const path of ['/menu-ok.html', '/menu-broken.html']) {
      await desktop.page.goto(app.url + path);
      expect(await desktop.page.locator('.menu-button').isVisible(), path).toBe(false);
      expect(
        await desktop.page.locator('#site-menu a', { hasText: 'Sign up' }).isVisible(),
        path,
      ).toBe(true);
    }
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
