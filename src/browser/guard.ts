/**
 * Safety guard (SPEC §7). This file currently holds the part needed by the deterministic
 * checks: deciding whether it is safe for ShipCheck to request a URL on its own.
 * Click/fill guarding for the AI flows is added in milestone M4.
 */

/**
 * Words in a link address that suggest that merely opening it could change something:
 * log the user out, delete data, confirm an email, unsubscribe, start a payment…
 * English and German.
 */
const RISKY_URL_WORDS = [
  'logout',
  'log-out',
  'log_out',
  'signout',
  'sign-out',
  'sign_out',
  'delete',
  'remove',
  'destroy',
  'deactivate',
  'unsubscribe',
  'cancel',
  'revoke',
  'reset',
  'confirm',
  'verify',
  'accept',
  'approve',
  'invite',
  'send',
  'publish',
  'pay',
  'purchase',
  'buy',
  'order',
  'export',
  'download',
  'abmelden',
  'ausloggen',
  'loeschen',
  'löschen',
  'entfernen',
  'kuendigen',
  'kündigen',
  'bestaetigen',
  'bestätigen',
  'bezahlen',
  'kaufen',
  'bestellen',
  'einladen',
];

/** Query parameters that usually carry one-time or personal tokens. */
const TOKEN_PARAMS = /(^|[?&])(token|code|key|signature|sig|otp|invite|secret)=/i;

/**
 * True if ShipCheck should NOT request this URL by itself (e.g. when checking for broken
 * links). Being too careful only costs a little coverage; being careless could log the user
 * out or delete something.
 */
export function isRiskyUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return true;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname + url.search).toLowerCase();
  } catch {
    return true;
  }
  if (TOKEN_PARAMS.test(url.search)) return true;
  // Compare whole words, so "/orders-guide" is fine but "/order/123/cancel" is not… and
  // "/payments" does not hide inside "/repayment-calculator".
  const words = path.split(/[^a-z0-9äöüß]+/).filter(Boolean);
  const compact = new Set(words);
  for (let i = 0; i < words.length - 1; i += 1) compact.add(`${words[i]}-${words[i + 1]}`);
  return RISKY_URL_WORDS.some((word) => compact.has(word));
}
