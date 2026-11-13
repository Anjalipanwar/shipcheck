import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNT,
  FAKE_PUBLISHABLE_KEY,
  FAKE_SECRET_KEY,
  resolvePublicPath,
  startFixtureServer,
  type FixtureServer,
} from '../helpers/fixture-server.js';

let app: FixtureServer;

beforeAll(async () => {
  app = await startFixtureServer();
});

afterAll(async () => {
  await app.close();
});

const get = (path: string) => fetch(app.url + path);
const post = (path: string, body: unknown) =>
  fetch(app.url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('buggy-app fixture: pages', () => {
  it.each([
    ['/', 'Quick notes for busy people'],
    ['/signup.html', 'Create your account'],
    ['/login.html', 'Log in'],
    ['/contact.html', 'Contact us'],
    ['/features.html', 'Compare the plans'],
    ['/dashboard.html', 'Your notes'],
    ['/account.html', 'Delete account'],
    ['/checkout.html', 'Card number'],
  ])('serves %s', async (path, marker) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain(marker);
  });

  it.each(['/robots.txt', '/sitemap.xml', '/favicon.svg', '/assets/styles.css'])(
    'serves %s',
    async (path) => {
      expect((await get(path)).status).toBe(200);
    },
  );

  it('binds to localhost on a random port, different per server', async () => {
    const other = await startFixtureServer();
    try {
      expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(other.port).not.toBe(app.port);
    } finally {
      await other.close();
    }
  });

  it('never serves files outside the public folder', async () => {
    expect(resolvePublicPath('/../BUGS.md')).toBeNull();
    expect(resolvePublicPath('/%2e%2e/%2e%2e/package.json')).toBeNull();
    expect(resolvePublicPath('/assets/../../BUGS.md')).toBeNull();
    expect(resolvePublicPath('/%E0%A4%A')).toBeNull();
    expect(resolvePublicPath('/assets/app.js')).toMatch(/public[\\/]assets[\\/]app\.js$/);
    expect((await get('/%2e%2e/BUGS.md')).status).toBe(404);
  });
});

describe('buggy-app fixture: planted bugs are really there', () => {
  it('#1 signup button only gets a handler on wide screens', async () => {
    const js = await (await get('/assets/signup.js')).text();
    expect(js).toContain('(min-width: 768px)');
    expect(await (await get('/signup.html')).text()).toContain('type="button"');
  });

  it('#2 contact form accepts an empty email and a 5,000-character name', async () => {
    const before = app.contactSubmissions.length;
    const response = await post('/api/contact', { name: 'x'.repeat(5000), email: '', message: '' });
    expect(response.status).toBe(200);
    expect(app.contactSubmissions).toHaveLength(before + 1);
    expect(app.contactSubmissions.at(-1)).toMatchObject({ email: '' });
    expect(app.contactSubmissions.at(-1)?.name).toHaveLength(5000);
    expect(await (await get('/contact.html')).text()).toContain('novalidate');
  });

  it('#3 landing page loads a script that throws', async () => {
    expect(await (await get('/')).text()).toContain('/assets/landing.js');
    expect(await (await get('/assets/landing.js')).text()).toContain('window.analytics.track');
  });

  it('#4 landing has one broken image and one broken internal link', async () => {
    const html = await (await get('/')).text();
    expect(html).toContain('src="/img/team.png"');
    expect(html).toContain('href="/pricing.html"');
    expect((await get('/img/team.png')).status).toBe(404);
    expect((await get('/pricing.html')).status).toBe(404);
  });

  it('#5 landing has no meta description or Open Graph tags (other pages do)', async () => {
    const landing = await (await get('/')).text();
    expect(landing).not.toContain('name="description"');
    expect(landing).not.toContain('property="og:');
    const contact = await (await get('/contact.html')).text();
    expect(contact).toContain('name="description"');
    expect(contact).toContain('property="og:image"');
  });

  it('#6 the JS bundle contains a fake secret key and a public key', async () => {
    const js = await (await get('/assets/app.js')).text();
    expect(FAKE_SECRET_KEY).toMatch(/^sk_live_[0-9a-zA-Z]{24,}$/);
    expect(js).toContain(FAKE_SECRET_KEY);
    expect(js).not.toContain('__FAKE_STRIPE_SECRET_KEY__');
    expect(js).toContain(FAKE_PUBLISHABLE_KEY);
  });

  it('#7 wrong password is rejected by the server but the page shows no error', async () => {
    const wrong = await post('/api/login', { email: DEMO_ACCOUNT.email, password: 'wrong' });
    expect(wrong.status).toBe(401);
    const right = await post('/api/login', DEMO_ACCOUNT);
    expect(right.status).toBe(200);
    const js = await (await get('/assets/login.js')).text();
    expect(js).not.toContain('showMessage');
  });

  it('#8 features page has a fixed-width table wider than a phone', async () => {
    expect(await (await get('/features.html')).text()).toContain('class="plans"');
    expect(await (await get('/assets/styles.css')).text()).toMatch(
      /\.plans\s*\{[^}]*width:\s*900px/,
    );
  });

  it('#9 delete-account endpoint counts every hit', async () => {
    const fresh = await startFixtureServer();
    try {
      expect(fresh.hits.deleteAccount).toBe(0);
      await fetch(`${fresh.url}/account.html`);
      expect(fresh.hits.deleteAccount).toBe(0);
      await fetch(`${fresh.url}/api/delete-account`, { method: 'POST' });
      expect(fresh.hits.deleteAccount).toBe(1);
    } finally {
      await fresh.close();
    }
  });

  it('#10 checkout endpoint counts submits and whether card digits were sent', async () => {
    const fresh = await startFixtureServer();
    const send = (cardNumber: string) =>
      fetch(`${fresh.url}/api/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardNumber }),
      });
    try {
      await fetch(`${fresh.url}/checkout.html`);
      expect(fresh.hits).toMatchObject({ checkoutSubmit: 0, cardDataReceived: 0 });
      await send('');
      expect(fresh.hits).toMatchObject({ checkoutSubmit: 1, cardDataReceived: 0 });
      await send('4242 4242');
      expect(fresh.hits).toMatchObject({ checkoutSubmit: 2, cardDataReceived: 1 });
    } finally {
      await fresh.close();
    }
  });
});

describe('buggy-app fixture: things that work (so they must not be reported)', () => {
  it('signup creates an account that can then log in', async () => {
    const account = { email: 'shipcheck+unit@example.com', password: 'longenough1' };
    expect((await post('/api/signup', account)).status).toBe(200);
    expect((await post('/api/login', account)).status).toBe(200);
    expect((await post('/api/signup', account)).status).toBe(409);
  });

  it('signup rejects a bad email and a short password with a readable message', async () => {
    const badEmail = await post('/api/signup', { email: 'nope', password: 'longenough1' });
    expect(badEmail.status).toBe(400);
    expect(((await badEmail.json()) as { error: string }).error).toMatch(/valid email/);
    const shortPassword = await post('/api/signup', { email: 'a@example.com', password: 'x' });
    expect(shortPassword.status).toBe(400);
  });

  it('records every request and answers unknown API routes with 404', async () => {
    expect((await post('/api/nope', {})).status).toBe(404);
    expect(app.requests).toContain('POST /api/nope');
    expect(app.requests).toContain('GET /');
  });
});
