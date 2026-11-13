import { describe, expect, it } from 'vitest';
import {
  createDomainLock,
  decideRoute,
  isLocalAddress,
  siteKey,
} from '../../../src/browser/domain.js';

const key = (url: string) => siteKey(new URL(url));

describe('isLocalAddress', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '::1', '[::1]'])(
    '%s is local',
    (host) => {
      expect(isLocalAddress(host)).toBe(true);
    },
  );
  it.each(['example.com', 'localhost.example.com', '127.0.0.2', '192.168.1.5', 'notlocalhost'])(
    '%s is not local',
    (host) => {
      expect(isLocalAddress(host)).toBe(false);
    },
  );
});

describe('siteKey', () => {
  it('uses the registrable domain for normal sites', () => {
    expect(key('https://www.example.com/a')).toBe('example.com');
    expect(key('https://app.shop.example.co.uk')).toBe('example.co.uk');
  });

  it('treats each app on a shared host as its own site', () => {
    expect(key('https://myapp.lovable.app')).toBe('myapp.lovable.app');
    expect(key('https://other.lovable.app')).toBe('other.lovable.app');
    expect(key('https://myapp.vercel.app')).toBe('myapp.vercel.app');
    expect(key('https://me.github.io')).toBe('me.github.io');
  });

  it('covers shared hosts that the Public Suffix List misses', () => {
    expect(key('https://mine.v0.app')).toBe('mine.v0.app');
    expect(key('https://deep.mine.v0.app')).toBe('mine.v0.app');
    expect(key('https://mine.glitch.me')).not.toBe(key('https://yours.glitch.me'));
  });

  it('uses exact host and port for local and IP addresses', () => {
    expect(key('http://localhost:3000')).toBe('localhost:3000');
    expect(key('http://127.0.0.1')).toBe('127.0.0.1:80');
    expect(key('https://10.0.0.5')).toBe('10.0.0.5:443');
    expect(key('http://[::1]:8080')).toBe('::1:8080');
  });
});

describe('createDomainLock', () => {
  it('allows the same site, including subdomains and other paths', () => {
    const lock = createDomainLock('https://www.example.com/start');
    expect(lock.isAllowed('https://www.example.com/pricing')).toBe(true);
    expect(lock.isAllowed('https://app.example.com/login')).toBe(true);
    expect(lock.isAllowed('http://example.com/')).toBe(true);
  });

  it('blocks other sites, look-alikes and other apps on the same host', () => {
    const lock = createDomainLock('https://myapp.lovable.app');
    expect(lock.isAllowed('https://other.lovable.app')).toBe(false);
    expect(lock.isAllowed('https://lovable.app')).toBe(false);
    expect(lock.isAllowed('https://accounts.google.com/o/oauth2')).toBe(false);
    expect(lock.isAllowed('https://myapp.lovable.app.evil.com')).toBe(false);
    expect(lock.isAllowed('https://evil.com/?next=https://myapp.lovable.app')).toBe(false);
    expect(lock.isAllowed('https://myapp.lovable.app@evil.com/')).toBe(false);
  });

  it('locks local apps to their exact port', () => {
    const lock = createDomainLock('http://127.0.0.1:5173/');
    expect(lock.isAllowed('http://127.0.0.1:5173/login')).toBe(true);
    expect(lock.isAllowed('http://127.0.0.1:9999/')).toBe(false);
    expect(lock.isAllowed('http://localhost:5173/')).toBe(false);
  });

  it('allows in-browser addresses and blocks every other scheme', () => {
    const lock = createDomainLock('https://example.com');
    expect(lock.isAllowed('about:blank')).toBe(true);
    expect(lock.isAllowed('data:text/html,hi')).toBe(true);
    expect(lock.isAllowed('blob:https://example.com/123')).toBe(true);
    expect(lock.isAllowed('file:///etc/passwd')).toBe(false);
    expect(lock.isAllowed('ftp://example.com/')).toBe(false);
    expect(lock.isAllowed('javascript:alert(1)')).toBe(false);
    expect(lock.isAllowed('not a url')).toBe(false);
    expect(lock.isAllowed('')).toBe(false);
  });

  it('refuses a target that is not a web address', () => {
    expect(() => createDomainLock('file:///tmp/x.html')).toThrow();
  });
});

describe('decideRoute', () => {
  const lock = createDomainLock('https://example.com');
  const offSite = 'https://other.test/';

  it('blocks top-level navigations to other sites', () => {
    expect(decideRoute({ url: offSite, isNavigation: true, isTopFrame: true }, lock)).toBe('block');
  });
  it('allows top-level navigations within the site', () => {
    expect(
      decideRoute({ url: 'https://example.com/x', isNavigation: true, isTopFrame: true }, lock),
    ).toBe('allow');
  });
  it('allows background requests and embedded frames from other sites', () => {
    expect(decideRoute({ url: offSite, isNavigation: false, isTopFrame: false }, lock)).toBe(
      'allow',
    );
    expect(decideRoute({ url: offSite, isNavigation: true, isTopFrame: false }, lock)).toBe(
      'allow',
    );
  });
});
