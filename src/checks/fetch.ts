import type { DomainLock } from '../browser/domain.js';

export interface SafeFetchOptions {
  lock: DomainLock;
  userAgent: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  /** Stop reading the body after this many bytes. */
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  /** Final HTTP status, or 0 when no answer was received. */
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  body: string;
  /** Set when the request could not be completed. */
  error?: 'blocked-by-domain-lock' | 'redirected-off-site' | 'too-many-redirects' | 'network';
  errorDetail?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 3_000_000;

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/**
 * A request made by ShipCheck itself (not by the browser). It obeys the same domain lock as
 * the browser: redirects are followed by hand and every hop is checked, so we never contact a
 * site other than the one being tested.
 */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const {
    lock,
    userAgent,
    method = 'GET',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = 5,
  } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const failure = (error: SafeFetchResult['error'], errorDetail?: string): SafeFetchResult => ({
      status: 0,
      finalUrl: current,
      headers: {},
      body: '',
      ...(error ? { error } : {}),
      ...(errorDetail ? { errorDetail } : {}),
    });

    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return failure('network', 'not a valid address');
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !lock.isAllowed(current)) {
      return failure(hop === 0 ? 'blocked-by-domain-lock' : 'redirected-off-site');
    }

    let response: Response;
    try {
      response = await fetch(current, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': userAgent, accept: '*/*' },
      });
    } catch (error) {
      return failure('network', error instanceof Error ? error.name : 'request failed');
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }

    let body = '';
    if (method === 'GET') {
      try {
        body = await readLimited(response, maxBytes);
      } catch {
        body = '';
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
    return {
      status: response.status,
      finalUrl: current,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }

  return {
    status: 0,
    finalUrl: current,
    headers: {},
    body: '',
    error: 'too-many-redirects',
  };
}
