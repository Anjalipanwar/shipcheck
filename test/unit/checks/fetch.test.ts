import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDomainLock } from '../../../src/browser/domain.js';
import { safeFetch } from '../../../src/checks/fetch.js';

/** Two tiny local servers: "site" is the app under test, "outside" stands in for another website. */
let site: Server;
let outside: Server;
let siteUrl: string;
let outsideUrl: string;
const outsideRequests: string[] = [];
const siteAgents: string[] = [];

const listen = (server: Server) =>
  new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });

beforeAll(async () => {
  outside = createServer((req, res) => {
    outsideRequests.push(req.url ?? '');
    res.end('outside');
  });
  outsideUrl = await listen(outside);
  site = createServer((req, res) => {
    siteAgents.push(req.headers['user-agent'] ?? '');
    const path = req.url ?? '/';
    if (path === '/hop') return void res.writeHead(302, { location: '/final' }).end();
    if (path === '/leave')
      return void res.writeHead(302, { location: `${outsideUrl}/landed` }).end();
    if (path === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
    if (path === '/big') return void res.end('x'.repeat(50_000));
    if (path === '/slow') return void setTimeout(() => res.end('late'), 2_000);
    if (path === '/missing') return void res.writeHead(404).end('nope');
    res.writeHead(200, { 'x-test': 'yes' }).end(`hello from ${path}`);
  });
  siteUrl = await listen(site);
});

afterAll(() => {
  site.closeAllConnections();
  outside.closeAllConnections();
  site.close();
  outside.close();
});

const options = () => ({ lock: createDomainLock(siteUrl), userAgent: 'TestAgent ShipCheck/0.0.0' });

describe('safeFetch', () => {
  it('fetches a page on the tested site and sends our user agent', async () => {
    const result = await safeFetch(`${siteUrl}/page`, options());
    expect(result).toMatchObject({
      status: 200,
      body: 'hello from /page',
      finalUrl: `${siteUrl}/page`,
    });
    expect(result.headers['x-test']).toBe('yes');
    expect(result.error).toBeUndefined();
    expect(siteAgents.at(-1)).toBe('TestAgent ShipCheck/0.0.0');
  });

  it('follows redirects that stay on the site', async () => {
    const result = await safeFetch(`${siteUrl}/hop`, options());
    expect(result).toMatchObject({
      status: 200,
      body: 'hello from /final',
      finalUrl: `${siteUrl}/final`,
    });
  });

  it('refuses to contact another site', async () => {
    const result = await safeFetch(`${outsideUrl}/direct`, options());
    expect(result).toMatchObject({ status: 0, error: 'blocked-by-domain-lock' });
    expect(outsideRequests).toEqual([]);
  });

  it('stops at a redirect that leaves the site, without contacting the other site', async () => {
    const result = await safeFetch(`${siteUrl}/leave`, options());
    expect(result).toMatchObject({ status: 0, error: 'redirected-off-site' });
    expect(outsideRequests).toEqual([]);
  });

  it('refuses non-web addresses', async () => {
    expect((await safeFetch('file:///etc/hosts', options())).error).toBe('blocked-by-domain-lock');
    expect((await safeFetch('not a url', options())).error).toBe('network');
  });

  it('gives up on endless redirects', async () => {
    expect(await safeFetch(`${siteUrl}/loop`, { ...options(), maxRedirects: 3 })).toMatchObject({
      status: 0,
      error: 'too-many-redirects',
    });
  });

  it('reports error statuses as they are', async () => {
    expect(await safeFetch(`${siteUrl}/missing`, options())).toMatchObject({
      status: 404,
      body: 'nope',
    });
  });

  it('reads no more than the size limit', async () => {
    const result = await safeFetch(`${siteUrl}/big`, { ...options(), maxBytes: 1000 });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1000);
  });

  it('HEAD returns the status without a body', async () => {
    expect(await safeFetch(`${siteUrl}/page`, { ...options(), method: 'HEAD' })).toMatchObject({
      status: 200,
      body: '',
    });
  });

  it('times out instead of hanging', async () => {
    const started = Date.now();
    const result = await safeFetch(`${siteUrl}/slow`, { ...options(), timeoutMs: 200 });
    expect(result).toMatchObject({ status: 0, error: 'network' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('reports an unreachable server as a network error', async () => {
    const dead = createServer();
    const deadUrl = await listen(dead);
    await new Promise((resolve) => dead.close(resolve));
    const result = await safeFetch(deadUrl, { lock: createDomainLock(deadUrl), userAgent: 'x' });
    expect(result).toMatchObject({ status: 0, error: 'network' });
  });
});
