/**
 * Recognises payment card numbers. Used by the safety backstop and the guard so that a card
 * number can never be typed into a page or leave the browser in a request (SPEC §7.2).
 */

/** 13–19 digits, optionally grouped with single spaces or dashes, not part of a longer number. */
const CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

/** The checksum every real card number satisfies. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Card brands by starting digits and length. Without this, one in ten random long numbers
 * (ids, timestamps) would pass the checksum and be mistaken for a card.
 */
const BRANDS: readonly [RegExp, readonly number[]][] = [
  [/^4/, [13, 16]], // Visa
  [/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/, [16]], // Mastercard
  [/^3[47]/, [15]], // American Express
  [/^(6011|65|64[4-9])/, [16]], // Discover
  [/^35(2[89]|[3-8]\d)/, [16]], // JCB
  [/^3(0[0-5]|[68])/, [14]], // Diners Club
  [/^62/, [16, 17, 18, 19]], // UnionPay
  [/^(50|5[6-9]|6[0-9])/, [16, 18, 19]], // Maestro
];

export function isCardNumber(digits: string): boolean {
  return (
    BRANDS.some(([prefix, lengths]) => prefix.test(digits) && lengths.includes(digits.length)) &&
    luhnValid(digits)
  );
}

function variants(text: string): string[] {
  const all = [text];
  try {
    const decoded = decodeURIComponent(text.replace(/\+/g, ' '));
    if (decoded !== text) all.push(decoded);
  } catch {
    // Not URL-encoded text; the raw form is checked anyway.
  }
  return all;
}

/** True if the text (plain, JSON or form-encoded) contains something that is a card number. */
export function containsCardNumber(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const variant of variants(text)) {
    for (const match of variant.matchAll(CANDIDATE)) {
      if (isCardNumber(match[0].replace(/[ -]/g, ''))) return true;
    }
  }
  return false;
}
