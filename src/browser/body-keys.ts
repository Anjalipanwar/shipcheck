/**
 * The field names inside a request body — never the values. Used to tell a form's own request
 * from other requests sent at the same moment (tracking beacons, analytics): a form's request
 * carries the names of its fields, a beacon does not.
 */
const MAX_KEYS = 60;

function jsonKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || into.size >= MAX_KEYS || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) jsonKeys(item, into, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    into.add(key);
    jsonKeys(item, into, depth + 1);
  }
}

export function bodyKeys(body: string | null | undefined): string[] {
  if (!body) return [];
  const keys = new Set<string>();
  const text = body.slice(0, 200_000);
  try {
    jsonKeys(JSON.parse(text), keys);
  } catch {
    // Not JSON: a multipart body names its parts, a classic form body is key=value&key=value.
    for (const match of text.matchAll(/\bname="([^"]{1,100})"/g)) keys.add(match[1] ?? '');
    if (keys.size === 0 && /^[^=&\s]{1,100}=/.test(text)) {
      for (const key of new URLSearchParams(text).keys()) keys.add(key);
    }
  }
  return [...keys].filter(Boolean).slice(0, MAX_KEYS);
}

/** Addresses that collect statistics, not form data. Only used when the body says nothing. */
const TRACKING_URL =
  /(^|[/._-])(track\w*|analytics|collect|beacon|telemetry|metrics|events?|pixel|rum|vitals|log(s|ging)?|ingest)([/._?-]|$)/i;

const simple = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Is this request the form's own? Yes if its body names one of the form's fields. When the form
 * has no field names, or the body could not be read, only requests to tracking-like addresses
 * are ruled out.
 */
export function isFormRequest(
  request: { url: string; bodyKeys?: readonly string[] | undefined },
  formKeys: readonly string[],
): boolean {
  // Very short names ("t", "id") match by accident, so they are not compared.
  const body = (request.bodyKeys ?? []).map(simple).filter((key) => key.length >= 3);
  const form = formKeys.map(simple).filter((key) => key.length >= 3);
  const unreadable = (request.bodyKeys ?? []).length === 0;
  if (unreadable || form.length === 0) {
    let path = request.url;
    try {
      path = new URL(request.url).pathname;
    } catch {
      // keep the raw text
    }
    return !TRACKING_URL.test(path);
  }
  return form.some((key) => body.some((name) => name.includes(key) || key.includes(name)));
}

/**
 * The same question when ShipCheck typed something into the form first: then the form's own
 * request is the one that carries a typed value. Field names are not enough here — analytics
 * events have a "name" too. Only when no body could be read does the address decide.
 */
export function carriesTypedValue(request: {
  url: string;
  bodyKeys?: readonly string[] | undefined;
  echoes?: boolean | undefined;
}): boolean {
  if (request.echoes) return true;
  return (request.bodyKeys ?? []).length === 0 && isFormRequest(request, []);
}
