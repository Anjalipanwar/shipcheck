import { containsCardNumber } from './cards.js';

/**
 * Safety guard (SPEC §7). Two parts: deciding whether it is safe for ShipCheck to request a URL
 * on its own (used by the automatic checks), and deciding whether the AI tester may perform an
 * action on the page (used by the flows, further down).
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

/* ------------------------------------------------------------------------------------------
 * Action guard (SPEC §7.2, §7.3): decides, in code, whether the AI tester may perform an action.
 * It judges the real element on the page — never only the AI's own description of it.
 * ---------------------------------------------------------------------------------------- */

export type ForbiddenKind = 'destructive' | 'payment' | 'outward' | 'account-change' | 'log-out';

export type GuardVerdict =
  | { allowed: true }
  | { allowed: false; kind: ForbiddenKind | 'unverified' | 'unsupported'; reason: string };

/** What ShipCheck read from the page about the element an action targets. */
export interface ElementFacts {
  tag: string;
  /** The `type` attribute of inputs and buttons. */
  type: string;
  /** Visible text of the element, or of the button/link it sits in. */
  text: string;
  /** Accessible name parts: aria-label, title, label text, placeholder, value of input buttons. */
  label: string;
  /**
   * name, id and autocomplete of the element, plus id, name and test ids (data-testid, data-test,
   * data-cy, data-action) of the button or link it sits in, space-separated.
   */
  name: string;
  /** Link address, if the element is or sits inside a link. */
  href: string;
  /** Text of the submit button(s) of the form the element belongs to. */
  formSubmitText: string;
  /** True if the same form contains a card number, expiry or security code field. */
  formHasPaymentField: boolean;
  /**
   * Names of the icons inside the button (e.g. "trash-2 log-out"): from icon class names
   * (lucide-trash-2, fa-paper-plane), data-icon attributes, sprite references (#icon-send) and
   * image file names. Icon-only buttons often carry their meaning only here (audit A-05).
   */
  icons: string;
  /** True for a button that opens or closes something (a menu, a dropdown, a details box). */
  toggle: boolean;
  /** The fields of the form the element belongs to (to tell a contact form from a chat box). */
  formFields: FormField[];
}

/** One field of a form, as read from the page. */
export interface FormField {
  tag: string;
  type: string;
  /** name, id and autocomplete, space-separated. */
  keys: string;
  /** Label text, aria-label or placeholder. */
  label: string;
}

/** An action as proposed by the AI (Stagehand's observe result). */
export interface ProposedAction {
  selector: string;
  description: string;
  method?: string | undefined;
  arguments?: string[] | undefined;
}

const word = (pattern: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');

/**
 * Forbidden wording, English and German. Being too strict only costs a little coverage;
 * being too loose could delete an account or charge a card.
 */
const FORBIDDEN: readonly [ForbiddenKind, RegExp][] = [
  [
    'destructive',
    word(
      'delet(e|es|ing)|remov(e|es|ing)|eras(e|es|ing)|destroy(s|ing)?|wip(e|es|ing)|' +
        'deactivat(e|es|ing)|terminat(e|es|ing)|unsubscrib(e|es|ing)|revok(e|es|ing)|downgrad(e|es|ing)|' +
        'close (my |your |this )?account|clear all|empty trash|' +
        'cancel (my |your |the |this )?(subscription|plan|membership|account|order|booking|trial)|' +
        'reset (all|data|account|everything)|leave (the |this )?(team|workspace|organi[sz]ation|group)|' +
        'löschen|loeschen|entfernen|kündigen|kuendigen|abbestellen|deaktivieren|zurücksetzen|' +
        'zuruecksetzen|widerrufen|stornieren|konto schließen|konto schliessen|abo beenden|' +
        // Audit A-05: archiving, binning, discarding, disabling, disconnecting, banning.
        'archiv(e|es|ing)|trash|move (it |this |them )?to (the )?(trash|bin)|discard(s|ing)?|' +
        'disabl(e|es|ing)|disconnect(s|ing)?|ban|archivieren|in den papierkorb|verwerfen|trennen|sperren',
    ),
  ],
  [
    // Audit A-05: logging out ends the test account's session; the rest of the run needs it.
    'log-out',
    word('log ?out|logging out|sign ?out|signing out|abmelden|ausloggen|abmeldung'),
  ],
  [
    'payment',
    word(
      'pay(s|ing)?|pay now|purchas(e|es|ing)|buy(s|ing)?|buy now|place (your |my )?order|order now|donate|top up|' +
        '(complete|confirm|submit|finish) (your |my |the )?(payment|order|purchase|booking)|' +
        'add (a |credit |debit |new )*card|start (my |your )?(paid )?subscription|' +
        'bezahlen|zahlen|kaufen|jetzt kaufen|bestellen|zahlungspflichtig bestellen|kostenpflichtig|' +
        'jetzt buchen|spenden',
    ),
  ],
  [
    'outward',
    word(
      'invit(e|es|ing)|shar(e|es|ing)|publish(es|ing)?|post|posting|tweet|go live|refer a friend|' +
        'send (an? |the )?(invite|invitation|invites|e-?mail|sms|newsletter|campaign|reminder|notification)s?|' +
        'send to (all|everyone|team|customers|contacts)|' +
        'einladen|einladung senden|veröffentlichen|veroeffentlichen|teilen|posten|versenden|' +
        'e-?mail senden',
    ),
  ],
  [
    'account-change',
    word(
      '(change|update|reset|set( a)? new|forgot) (my |your )?(password|e-?mail( address)?)|' +
        'passwort (ändern|aendern|zurücksetzen|zuruecksetzen|vergessen)|' +
        'e-?mail(-adresse)? (ändern|aendern)',
    ),
  ],
];

const KIND_TEXT: Record<ForbiddenKind, string> = {
  destructive: 'it could delete or cancel something',
  payment: 'it could start a payment',
  outward: 'it could send or publish something to other people',
  'account-change': 'it could change the account’s password or email',
  'log-out': 'it would log the test account out',
};

/**
 * A plain "Send" (audit A-05). It could send a chat message or an email to other people, so it
 * is refused, except on a contact form, where the visitor writes to the app's owner.
 */
const PLAIN_SEND = word(
  'send|send (a |the |your |this |us a )?(message|note)|senden|absenden|abschicken|verschicken|nachricht senden',
);

export interface ForbiddenMatch {
  kind: ForbiddenKind;
  phrase: string;
  /** A plain "Send": allowed on a contact form only. */
  plainSend?: true;
}

/** Finds forbidden wording in a button text, label or description. */
export function matchForbidden(text: string): ForbiddenMatch | null {
  const normal = text.replace(/\s+/g, ' ').trim();
  if (!normal) return null;
  for (const [kind, pattern] of FORBIDDEN) {
    const match = pattern.exec(normal);
    if (match) return { kind, phrase: match[0] };
  }
  const send = PLAIN_SEND.exec(normal);
  return send ? { kind: 'outward', phrase: send[0], plainSend: true } : null;
}

/** "btnDeleteNote", "delete-account", "logout_button" → separate words. */
const wordsOf = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.:/#]+/g, ' ');

/** Icon names that mean something forbidden but are not words of their own. */
const ICON_NAMES: readonly [ForbiddenKind, RegExp][] = [
  ['destructive', /^(bin|eraser|user-minus|user-x|delete-forever|delete-outline)(-|$)/],
  ['outward', /^(paper-?plane|send-horizontal)(-|$)/],
  ['log-out', /^(right-from-bracket|arrow-right-from-bracket|box-arrow-right|exit-to-app)(-|$)/],
];

function matchIcons(icons: string): ForbiddenMatch | null {
  for (const icon of icons.toLowerCase().split(/\s+/).filter(Boolean)) {
    for (const [kind, pattern] of ICON_NAMES) {
      if (pattern.test(icon)) return { kind, phrase: `${icon} icon` };
    }
    const hit = matchForbidden(wordsOf(icon));
    if (hit) return { ...hit, phrase: `${icon} icon` };
  }
  return null;
}

/** In names and ids, "post" usually means a blog post ("post-42"), not posting something. */
function matchName(name: string): ForbiddenMatch | null {
  const hit = matchForbidden(wordsOf(name));
  return hit && !(hit.kind === 'outward' && /^post(ing)?$/i.test(hit.phrase)) ? hit : null;
}

const RECIPIENT_KEY = /^(to|recipients?|cc|bcc|empf(ä|ae)nger|invitees?|send-?to|share-?with)$/i;
const RECIPIENT_LABEL =
  /^(to|an|cc|bcc|recipients?|empfänger|empfaenger|send to|share with|invite)\s*:?$/i;
const MESSAGE_FIELD =
  /message|nachricht|comment|kommentar|question|frage|feedback|anliegen|inquiry|enquiry/i;
const SENDER_FIELD = /e-?mail|\bname\b|full-?name|first-?name|vorname/i;

/**
 * A contact form: the visitor gives their own name or email address and a message, and there
 * is no field for whom to send it to (unlike an email composer, an invite or a share form).
 */
export function looksLikeContactForm(fields: readonly FormField[]): boolean {
  if (
    fields.some(
      (f) =>
        f.keys.split(/\s+/).some((key) => RECIPIENT_KEY.test(key)) ||
        RECIPIENT_LABEL.test(f.label.trim()),
    )
  ) {
    return false;
  }
  const message = fields.find(
    (f) => f.tag === 'textarea' || MESSAGE_FIELD.test(`${f.keys} ${f.label}`),
  );
  return (
    message !== undefined &&
    fields.some(
      (f) => f !== message && (f.type === 'email' || SENDER_FIELD.test(`${f.keys} ${f.label}`)),
    )
  );
}

const PAYMENT_FIELD =
  /\bcc-(number|exp|exp-month|exp-year|csc|name|type)\b|card[\s_-]?(number|no|num)\b|cardnumber|cc[\s_-]?(num|number)|\bcvc\b|\bcvv\b|\bcsc\b|security code|expir(y|ation)|exp[\s_-]?date|\biban\b|kartennummer|kreditkarte|prüfziffer|pruefziffer|ablaufdatum/i;

/** True for card number, expiry and security code fields (and IBAN fields). */
export function isPaymentField(
  facts: Pick<ElementFacts, 'name' | 'label'> & { placeholder?: string },
): boolean {
  return PAYMENT_FIELD.test(`${facts.name} ${facts.label} ${facts.placeholder ?? ''}`);
}

/**
 * Words in a link's address that make following it unsafe. Links to a checkout or payment page
 * are deliberately not listed: opening such a page is harmless, and the flow then stops there
 * with the note "Reached payment — stopped by design".
 */
const DESTRUCTIVE_LINK_WORDS = new Set([
  'delete',
  'destroy',
  'remove',
  'erase',
  'deactivate',
  'unsubscribe',
  'cancel',
  'revoke',
  'invite',
  'publish',
  'logout',
  'signout',
  'loeschen',
  'löschen',
  'entfernen',
  'kuendigen',
  'kündigen',
  'abmelden',
  'einladen',
]);

export function isDestructiveLink(href: string): boolean {
  try {
    const url = new URL(href);
    return decodeURIComponent(url.pathname + url.search)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/(log|sign)[\s_-]out/g, '$1out')
      .split(/[^a-z0-9äöüß]+/)
      .some((part) => DESTRUCTIVE_LINK_WORDS.has(part));
  } catch {
    return false;
  }
}

/** Methods that only look at or move around the page. */
const PASSIVE_METHODS = new Set([
  'scrollto',
  'scrollintoview',
  'scroll',
  'hover',
  'nextchunk',
  'prevchunk',
]);
const CLICK_METHODS = new Set(['click', 'doubleclick', 'dblclick', 'check', 'uncheck']);
const TEXT_METHODS = new Set(['fill', 'type']);
const SELECT_METHODS = new Set(['selectoption', 'selectoptionfromdropdown']);

const block = (
  kind: Exclude<GuardVerdict, { allowed: true }>['kind'],
  reason: string,
): GuardVerdict => ({
  allowed: false,
  kind,
  reason,
});

/**
 * The guard's decision for one proposed action. `facts` is what ShipCheck itself read from the
 * element; if the element could not be found and read, the action is refused (fail closed).
 */
export function judgeAction(action: ProposedAction, facts: ElementFacts | null): GuardVerdict {
  const method = (action.method ?? '').trim().toLowerCase();
  if (PASSIVE_METHODS.has(method)) return { allowed: true };
  const known =
    CLICK_METHODS.has(method) ||
    TEXT_METHODS.has(method) ||
    SELECT_METHODS.has(method) ||
    method === 'press';
  if (!known)
    return block('unsupported', `“${method || 'unknown'}” is not an action ShipCheck performs`);
  if (!facts) {
    return block('unverified', 'ShipCheck could not read the element, so it was not touched');
  }

  const values = (action.arguments ?? []).join(' ');
  if (isPaymentField(facts) || containsCardNumber(values)) {
    return block('payment', 'it is a payment field; ShipCheck never enters card details');
  }
  if (facts.formHasPaymentField && !TEXT_METHODS.has(method) && !SELECT_METHODS.has(method)) {
    return block('payment', 'it belongs to a payment form');
  }

  if (TEXT_METHODS.has(method) || SELECT_METHODS.has(method)) return { allowed: true };

  // Clicking, or pressing a key (Enter submits the form the field is in). Everything that names
  // the control counts: its text, accessible name, icons, name, id and test ids (audit A-05).
  const hits =
    method === 'press'
      ? [matchForbidden(facts.formSubmitText)]
      : [
          matchForbidden(facts.text),
          matchForbidden(facts.label),
          matchForbidden(
            facts.formSubmitText && facts.type === 'submit' ? facts.formSubmitText : '',
          ),
          matchForbidden(action.description),
          matchIcons(facts.icons),
          matchName(facts.name),
        ];
  const contactForm = looksLikeContactForm(facts.formFields);
  for (const hit of hits) {
    if (!hit || (hit.plainSend && contactForm)) continue;
    return block(hit.kind, `${KIND_TEXT[hit.kind]} (“${hit.phrase}”)`);
  }
  if (facts.href && method !== 'press' && isDestructiveLink(facts.href)) {
    return block('destructive', 'its link address suggests deleting, cancelling or sending');
  }
  const nameless =
    !facts.text.trim() &&
    !facts.label.trim() &&
    !facts.name.trim() &&
    !facts.icons.trim() &&
    !facts.href &&
    !facts.toggle;
  if (method !== 'press' && nameless) {
    return block(
      'unverified',
      'it has no readable name, so ShipCheck cannot tell what it does and did not click it',
    );
  }
  return { allowed: true };
}
