import type { BrowserContext } from 'playwright';
import { containsCardNumber } from './cards.js';

/**
 * Safety backstop (SPEC §7.2, §7.3). It sits at the browser's network layer and knows nothing
 * about the guard or the AI: even if the guard were switched off or fooled, these requests
 * never leave the browser. Dialogs ("Are you sure?") are dismissed in evidence.ts.
 */

export type BackstopReason = 'payment-host' | 'card-number' | 'destructive-request';

export const BACKSTOP_REASON_TEXT: Record<BackstopReason, string> = {
  'payment-host': 'a request to a payment provider',
  'card-number': 'a request that contained a card number',
  'destructive-request': 'a request that could delete data, cancel something or start a payment',
};

/** Payment providers. Everything under these domains is blocked, except loading their script. */
const PAYMENT_DOMAINS = [
  'stripe.com',
  'stripe.network',
  'paypal.com',
  'braintreegateway.com',
  'braintree-api.com',
  'adyen.com',
  'adyenpayments.com',
  'klarna.com',
  'mollie.com',
  'paddle.com',
  'lemonsqueezy.com',
  'squareup.com',
  'checkout.com',
];

export function isPaymentHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return PAYMENT_DOMAINS.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/**
 * Words in the address of a data-changing request (POST, PUT, PATCH) that mean it must not be
 * sent. English and German. Plain page views (GET) are never judged by these words.
 */
const DESTRUCTIVE_REQUEST_WORDS = new Set([
  'delete',
  'destroy',
  'remove',
  'erase',
  'deactivate',
  'unsubscribe',
  'cancel',
  'revoke',
  'pay',
  'payment',
  'payments',
  'checkout',
  'charge',
  'charges',
  'purchase',
  'buy',
  'order',
  'orders',
  'invite',
  'invites',
  'invitation',
  'invitations',
  'publish',
  'loeschen',
  'löschen',
  'entfernen',
  'kuendigen',
  'kündigen',
  'bezahlen',
  'zahlung',
  'kaufen',
  'bestellen',
  'bestellung',
  'einladen',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function pathWords(url: URL): string[] {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  return path
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // deleteAccount → delete Account
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter(Boolean);
}

export interface RequestFacts {
  url: string;
  method: string;
  resourceType: string;
  postData: string | null;
}

/** Decides whether a request may leave the browser. Returns the reason if it may not. */
export function decideRequest(request: RequestFacts): BackstopReason | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const method = request.method.toUpperCase();

  if (containsCardNumber(request.postData) || containsCardNumber(url.search)) return 'card-number';
  if (isPaymentHost(url.hostname)) {
    // Loading the provider's script library is harmless and keeps apps that include it on every
    // page from crashing. Its payment frames, form posts and API calls are all blocked.
    return method === 'GET' && request.resourceType === 'script' ? null : 'payment-host';
  }
  if (method === 'DELETE') return 'destructive-request';
  if (!SAFE_METHODS.has(method) && pathWords(url).some((w) => DESTRUCTIVE_REQUEST_WORDS.has(w))) {
    return 'destructive-request';
  }
  return null;
}

/** Installs the backstop on a browser context. Blocked requests are aborted inside the browser. */
export async function installBackstop(
  context: BrowserContext,
  onBlocked: (reason: BackstopReason, request: RequestFacts, pageUrl: string) => void,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const readBody = (): string | null => {
      try {
        return request.postData() ?? request.postDataBuffer()?.toString('latin1') ?? null;
      } catch {
        return null;
      }
    };
    const postData = readBody();
    const facts: RequestFacts = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      postData,
    };
    const reason = decideRequest(facts);
    if (!reason) {
      await route.fallback();
      return;
    }
    let pageUrl = '';
    try {
      pageUrl = request.frame().page().url();
    } catch {
      // No page yet (brand-new tab); the request is blocked all the same.
    }
    onBlocked(reason, facts, pageUrl);
    await route.abort('blockedbyclient');
  });
}
