import { isIP } from 'node:net';
import { getDomain } from 'tldts';

/**
 * Hosting platforms where every customer gets their own subdomain, but which are missing from
 * the Public Suffix List. Without this, testing one app on such a host would allow the browser
 * to wander into every other app on it.
 */
const EXTRA_SHARED_HOSTS = ['v0.app', 'glitch.me', 'created.app', 'emergent.sh', 'softr.app'];

function bareHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Local test addresses: localhost, *.localhost, 127.0.0.1 and ::1. */
export function isLocalAddress(hostname: string): boolean {
  const host = bareHost(hostname);
  return (
    host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1'
  );
}

/**
 * True for apps on this computer or on a private network (10.x, 172.16–31.x, 192.168.x,
 * 169.254.x, fc00::/7, fe80::/10, *.local). Such apps may call other local servers.
 */
export function isPrivateNetworkTarget(targetUrl: string): boolean {
  let host: string;
  try {
    host = bareHost(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
  if (isLocalAddress(host) || host.endsWith('.local')) return true;
  if (isIP(host) === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(host) === 6) return /^(fc|fd|fe[89ab])/i.test(host);
  return false;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

/**
 * The "site" a URL belongs to. Two URLs with the same site key count as the same app.
 * - Local addresses and raw IP addresses: exact host and port.
 * - Everything else: the registrable domain (e.g. app.example.co.uk → example.co.uk), where
 *   shared hosts such as lovable.app or vercel.app count per subdomain.
 */
export function siteKey(url: URL): string {
  const host = bareHost(url.hostname);
  if (isLocalAddress(host) || isIP(host) !== 0) return `${host}:${effectivePort(url)}`;

  for (const shared of EXTRA_SHARED_HOSTS) {
    if (host.endsWith(`.${shared}`)) {
      const label = host
        .slice(0, -shared.length - 1)
        .split('.')
        .pop();
      return `${label}.${shared}`;
    }
  }
  // When the registrable domain cannot be worked out, fall back to the exact host (safest).
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export interface DomainLock {
  /** The site the run is locked to (for messages). */
  readonly site: string;
  /** May the browser, or one of our own requests, go to this URL? */
  isAllowed(url: string): boolean;
}

/** URL schemes that never leave the browser, so they are always fine. */
const NON_NETWORK_SCHEMES = new Set(['about:', 'data:', 'blob:']);

/** SPEC §7.1: the run may only navigate within the target site. */
export function createDomainLock(targetUrl: string): DomainLock {
  const target = new URL(targetUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('The app address must start with http:// or https://');
  }
  const site = siteKey(target);

  return {
    site,
    isAllowed(candidate: string): boolean {
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        return false;
      }
      if (NON_NETWORK_SCHEMES.has(url.protocol)) return true;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return siteKey(url) === site;
    },
  };
}

export type RouteDecision = 'allow' | 'block';

/**
 * Decides what to do with one browser request.
 * Only top-level page navigations (including new tabs and popups) are locked to the site.
 * Background requests and embedded frames are allowed, because apps need their off-site
 * backends, fonts and payment/login widgets in order to work at all.
 */
export function decideRoute(
  request: { url: string; isNavigation: boolean; isTopFrame: boolean },
  lock: DomainLock,
): RouteDecision {
  if (!request.isNavigation || !request.isTopFrame) return 'allow';
  return lock.isAllowed(request.url) ? 'allow' : 'block';
}
