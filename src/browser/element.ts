import type { Page } from 'playwright';
import { z } from 'zod';
import { isPaymentHost } from './backstop.js';
import type { ElementFacts } from './guard.js';

const READ_TIMEOUT_MS = 3000;

/**
 * Page-side helper (plain text, see below): defines `xpathOf(el)`, an exact address of an element
 * that `readElementFacts` and Playwright (`xpath=…`) both understand.
 */
export const XPATH_OF_SOURCE = `const xpathOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      let index = 1;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === node.tagName) index += 1;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
    }
    return '/' + parts.join('/');
  };`;

const FactsSchema = z.object({
  tag: z.string(),
  type: z.string(),
  text: z.string(),
  label: z.string(),
  name: z.string(),
  href: z.string(),
  formSubmitText: z.string(),
  formHasPaymentField: z.boolean(),
});

/*
 * The scripts below run inside the tested page and are kept as plain text on purpose (see
 * checks/collect.ts): functions handed to the browser can be rewritten by build tools in ways
 * that only work in Node. Whatever comes back is untrusted input and is validated.
 */
const FACTS_SCRIPT = `((selector) => {
  let matches = [];
  if (selector.startsWith('xpath=') || selector.startsWith('/')) {
    const found = document.evaluate(selector.replace(/^xpath=/, ''), document, null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < found.snapshotLength; i += 1) matches.push(found.snapshotItem(i));
  } else {
    matches = [...document.querySelectorAll(selector.replace(/^css=/, ''))];
  }
  matches = matches.filter((node) => node && node.nodeType === 1);
  if (matches.length !== 1) return null;
  const element = matches[0];
  const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300);
  const textOf = (node) => (node ? clean(node.innerText || node.textContent) : '');
  const attr = (node, name) => clean(node.getAttribute(name));
  const paymentField = 'input[autocomplete^="cc-"],input[name*="card" i],input[id*="card" i],' +
    'input[name*="cvc" i],input[name*="cvv" i],input[id*="cvc" i],input[id*="cvv" i]';
  // A click on an icon inside a button counts as a click on the button.
  const control = element.closest(
    'button,a[href],[role="button"],[role="link"],[role="menuitem"],summary') ?? element;
  const form = element.closest('form');
  const labels = [...(element.labels ?? [])].map(textOf);
  const labelledBy = (attr(control, 'aria-labelledby') + ' ' + attr(element, 'aria-labelledby'))
    .split(' ').filter(Boolean).map((id) => textOf(document.getElementById(id)));
  const isInputButton = element.tagName === 'INPUT' &&
    ['submit', 'button', 'reset'].includes(element.type);
  const submitText = form
    ? [...form.querySelectorAll(
        'button:not([type="button"]):not([type="reset"]),input[type="submit"]')]
        .map((node) => textOf(node) || clean(node.value) || attr(node, 'aria-label')).join(' | ')
    : '';
  return {
    tag: element.tagName.toLowerCase(),
    type: clean(element.type ?? attr(element, 'type')).toLowerCase(),
    text: textOf(control),
    label: [attr(control, 'aria-label'), attr(element, 'aria-label'), attr(control, 'title'),
      attr(element, 'title'), attr(element, 'placeholder'),
      isInputButton ? clean(element.value) : '', ...labels, ...labelledBy]
      .filter(Boolean).join(' | '),
    name: [attr(element, 'name'), clean(element.id), attr(element, 'autocomplete')]
      .filter(Boolean).join(' '),
    href: control.href ? String(control.href) : '',
    formSubmitText: clean(submitText),
    formHasPaymentField: form ? form.querySelector(paymentField) !== null : false,
  };
})`;

const PAYMENT_SCRIPT = `(() => {
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const fields = [...document.querySelectorAll(
    'input[autocomplete="cc-number"],input[autocomplete="cc-csc"],input[autocomplete="cc-exp"],' +
    'input[name*="cardnumber" i],input[name*="card-number" i],input[name*="card_number" i],' +
    'input[id*="cardnumber" i],input[id*="card-number" i],input[id*="card_number" i],' +
    'input[name="cvc" i],input[name="cvv" i]')].filter(visible);
  if (fields.length > 0) return 'card';
  // Only frames a visitor can see. Payment scripts such as Stripe.js add an invisible frame to
  // every page (for fraud checks); that is not a payment step.
  const seen = (node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.width >= 20 && box.height >= 20 &&
      style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  };
  const frames = [...document.querySelectorAll('iframe')].filter(seen)
    .map((frame) => frame.src || frame.name);
  return { frames, widget: document.querySelector(
    '.StripeElement,paypal-buttons,[data-paypal-button]') !== null };
})()`;

const PaymentSchema = z.union([
  z.literal('card'),
  z.object({ frames: z.array(z.string()), widget: z.boolean() }),
]);

/**
 * Reads the facts the guard needs about the element a selector points to. Returns null when the
 * selector matches nothing, matches more than one element, or points into an embedded frame —
 * the guard then refuses the action.
 */
export async function readElementFacts(page: Page, selector: string): Promise<ElementFacts | null> {
  try {
    const raw: unknown = await Promise.race([
      page.evaluate(`${FACTS_SCRIPT}(${JSON.stringify(selector)})`),
      new Promise((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ]);
    const parsed = FactsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isPaymentAddress(value: string): boolean {
  if (/^__privateStripeFrame/.test(value)) return true;
  try {
    return isPaymentHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Looks for signs of a payment step on the page (SPEC §7.2): card fields, or visible embedded
 * payment frames and buttons. Invisible provider frames do not count (they are on every page of
 * apps that load Stripe.js everywhere); the backstop blocks their traffic either way. Returns a short plain-English description, or null if there are none.
 */
export async function detectPayment(page: Page): Promise<string | null> {
  try {
    const found = PaymentSchema.safeParse(await page.evaluate(PAYMENT_SCRIPT));
    if (!found.success) return null;
    if (found.data === 'card') return 'a card number field';
    return found.data.widget || found.data.frames.some(isPaymentAddress)
      ? 'an embedded payment form'
      : null;
  } catch {
    return null;
  }
}
