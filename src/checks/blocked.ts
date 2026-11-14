import type { EvidenceEvent } from '../browser/evidence.js';

/**
 * Owner rule (2026-11-14): an error or failed request that ShipCheck caused itself, by blocking
 * a request (backstop, payment hosts) or a page (domain lock), is never reported as a bug in the
 * app. Such requests are tagged when they are blocked; the app's error messages that follow from
 * them are matched here. What was blocked is listed under "What we couldn't test" instead.
 */

/** How long after a block an unspecific network error ("Failed to fetch") is blamed on it. */
export const BLOCK_ECHO_WINDOW_MS = 5_000;

/** Messages a browser or app typically shows when a request did not get through. */
const NETWORK_FAILURE_TEXT =
  /failed to fetch|networkerror|network error|load failed|err_blocked_by_client|net::err_failed|failed to load/i;

type Block = Extract<EvidenceEvent, { kind: 'blocked-request' | 'blocked-navigation' }>;

const isBlock = (event: EvidenceEvent): event is Block =>
  event.kind === 'blocked-request' || event.kind === 'blocked-navigation';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** "js.stripe.com" → "stripe": how apps and provider scripts usually name the provider. */
function providerName(host: string): string {
  const labels = host.split('.');
  return labels.length >= 2 ? (labels[labels.length - 2] ?? '') : '';
}

function samePage(a: string, b: string): boolean {
  if (!a || !b) return true; // A brand-new tab has no address yet; do not rule it out.
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/** True if this error message is the app's reaction to one of ShipCheck's own blocks. */
function echoesBlock(text: string, event: EvidenceEvent, blocks: readonly Block[]): boolean {
  const lower = text.toLowerCase();
  const at = Date.parse(event.at);
  return blocks.some((block) => {
    if (block.device !== event.device) return false;
    const host = hostOf(block.url);
    const address = block.url.split(/[?#]/)[0]?.toLowerCase() ?? '';
    // Names the blocked address or its server: clearly about the block, whenever it shows up.
    if ((address && lower.includes(address)) || (host && lower.includes(host))) return true;
    // Otherwise only shortly after a block, on the same page, and only when the message is a
    // plain "did not get through" or names the blocked payment provider.
    const elapsed = at - Date.parse(block.at);
    if (elapsed < 0 || elapsed > BLOCK_ECHO_WINDOW_MS) return false;
    if (!samePage(block.pageUrl, event.pageUrl)) return false;
    if (NETWORK_FAILURE_TEXT.test(text)) return true;
    const provider = block.kind === 'blocked-request' && block.cause === 'payment-host';
    const name = providerName(host);
    return provider && name.length >= 4 && lower.includes(name);
  });
}

function isOurs(event: EvidenceEvent, blocks: readonly Block[]): boolean {
  if (event.kind === 'request-failed') return event.blockedBy === 'shipcheck';
  if (event.kind === 'console-error' || event.kind === 'page-error') {
    return echoesBlock(event.text, event, blocks);
  }
  return false;
}

/** True if ShipCheck caused this event by blocking something. */
export function causedByShipCheck(event: EvidenceEvent, all: readonly EvidenceEvent[]): boolean {
  return isOurs(event, all.filter(isBlock));
}

export interface Separated {
  /** Everything that may be judged as the app's own behaviour. */
  app: EvidenceEvent[];
  /** Errors and failed requests caused by ShipCheck's blocking (never reported as bugs). */
  ours: EvidenceEvent[];
}

export function separateShipCheckBlocking(events: readonly EvidenceEvent[]): Separated {
  const blocks = events.filter(isBlock);
  const app: EvidenceEvent[] = [];
  const ours: EvidenceEvent[] = [];
  for (const event of events) (isOurs(event, blocks) ? ours : app).push(event);
  return { app, ours };
}

const list = (items: string[], max = 3): string =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} and ${items.length - max} more`
    : items.join(', ');

/** The "What we couldn't test" lines for everything ShipCheck blocked on purpose. */
export function describeBlocking(events: readonly EvidenceEvent[], echoes: number): string[] {
  const lines: string[] = [];
  const requests = events.filter(
    (e): e is Extract<EvidenceEvent, { kind: 'blocked-request' }> => e.kind === 'blocked-request',
  );
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

  const payment = unique(
    requests.filter((e) => e.cause === 'payment-host').map((e) => hostOf(e.url)),
  );
  if (payment.length > 0) {
    lines.push(
      `Payment requests were blocked by design (to ${list(payment)}), so paying was not tested`,
    );
  }
  if (requests.some((e) => e.cause === 'card-number')) {
    lines.push('A request containing a card number was blocked by design');
  }
  const destructive = unique(
    requests
      .filter((e) => e.cause === 'destructive-request')
      .map((e) => {
        try {
          return `${e.method} ${new URL(e.url).pathname}`;
        } catch {
          return e.method;
        }
      }),
  );
  if (destructive.length > 0) {
    lines.push(
      `Requests that could delete data, cancel something or start a payment were blocked by design (${list(destructive)})`,
    );
  }
  const sites = unique(
    events.flatMap((e) => (e.kind === 'blocked-navigation' ? [hostOf(e.url)] : [])),
  );
  if (sites.length > 0) {
    lines.push(
      `Pages on other websites (${list(sites, 5)}) — ShipCheck only tests the app you asked for`,
    );
  }
  if (echoes > 0) {
    lines.push(
      `${echoes} ${echoes === 1 ? 'error message or failed request was' : 'error messages and failed requests were'} caused by this blocking and ${echoes === 1 ? 'is' : 'are'} not counted as ${echoes === 1 ? 'a problem' : 'problems'} in your app`,
    );
  }
  return lines;
}
