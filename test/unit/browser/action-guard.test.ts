import { describe, expect, it } from 'vitest';
import {
  isPaymentField,
  judgeAction,
  matchForbidden,
  type ElementFacts,
  type ProposedAction,
} from '../../../src/browser/guard.js';

const facts = (overrides: Partial<ElementFacts> = {}): ElementFacts => ({
  tag: 'button',
  type: 'button',
  text: 'Save changes',
  label: '',
  name: '',
  href: '',
  formSubmitText: '',
  formHasPaymentField: false,
  icons: '',
  toggle: false,
  formFields: [],
  ...overrides,
});
const action = (overrides: Partial<ProposedAction> = {}): ProposedAction => ({
  selector: 'xpath=/html/body/button[1]',
  description: 'a button',
  method: 'click',
  arguments: [],
  ...overrides,
});
const kind = (text: string) => matchForbidden(text)?.kind ?? null;

describe('forbidden wording (SPEC §7.3), English and German', () => {
  it.each([
    'Delete account',
    'Delete',
    'Remove member',
    'Yes, delete my data',
    'Cancel subscription',
    'Cancel my plan',
    'Deactivate',
    'Unsubscribe',
    'Close account',
    'Konto löschen',
    'Löschen',
    'Abo kündigen',
    'Mitglied entfernen',
    'Deleting your workspace',
    'Removes all notes',
    'Bestellung stornieren',
  ])('destructive: %s', (text) => expect(kind(text)).toBe('destructive'));

  it.each([
    'Pay €9 now',
    'Pay',
    'Buy now',
    'Purchase',
    'Place order',
    'Place your order',
    'Confirm payment',
    'Complete purchase',
    'Add card',
    'Jetzt kaufen',
    'Zahlungspflichtig bestellen',
    'Bezahlen',
    'Kostenpflichtig buchen',
  ])('payment: %s', (text) => expect(kind(text)).toBe('payment'));

  it.each([
    'Send invite',
    'Invite teammates',
    'Publish',
    'Share',
    'Post',
    'Send email',
    'Send newsletter',
    'Einladen',
    'Veröffentlichen',
    'Teilen',
  ])('outward: %s', (text) => expect(kind(text)).toBe('outward'));

  it.each([
    'Change password',
    'Update email',
    'Reset password',
    'Forgot password?',
    'Passwort ändern',
    'E-Mail-Adresse ändern',
    'Passwort vergessen',
  ])('account change: %s', (text) => expect(kind(text)).toBe('account-change'));

  it.each([
    'Save changes',
    'Create account',
    'Log in',
    'Add note',
    'Get started free',
    'Cancel', // the safe button of a dialog
    'Upgrade to Pro', // only opens the payment page, where the flow stops
    'Payment settings',
    'Paypal',
    'Display name',
    'Repay calculator',
    'Postcode',
    'Shared notes',
    'Deleted items',
    'Posts',
    'Paid plans',
    'Speichern',
    'Anmelden',
    'Login',
    'Sign in',
    'Logo',
    'Sender',
    'Sent items',
    'Archived notes',
    'Disabled',
    '',
  ])('allowed: %s', (text) => expect(kind(text)).toBeNull());
});

describe('payment fields', () => {
  it('recognises card, expiry, security code and IBAN fields', () => {
    expect(isPaymentField({ name: 'cardnumber card-number cc-number', label: 'Card number' })).toBe(
      true,
    );
    expect(isPaymentField({ name: 'cvc', label: '' })).toBe(true);
    expect(isPaymentField({ name: 'x', label: 'Security code' })).toBe(true);
    expect(isPaymentField({ name: 'exp-date cc-exp', label: 'Expiry date' })).toBe(true);
    expect(isPaymentField({ name: 'iban', label: 'IBAN' })).toBe(true);
    expect(isPaymentField({ name: 'k', label: 'Kartennummer' })).toBe(true);
  });
  it('leaves ordinary fields alone', () => {
    expect(isPaymentField({ name: 'email', label: 'Email' })).toBe(false);
    expect(isPaymentField({ name: 'note', label: 'New note' })).toBe(false);
    expect(isPaymentField({ name: 'discard-reason', label: 'Postcard text' })).toBe(false);
    expect(isPaymentField({ name: 'displayName nickname', label: 'Display name' })).toBe(false);
  });
});

describe('judgeAction', () => {
  it('allows ordinary clicks and typing', () => {
    expect(judgeAction(action(), facts())).toEqual({ allowed: true });
    expect(
      judgeAction(
        action({ method: 'fill', arguments: ['hello'] }),
        facts({ tag: 'input', type: 'text', text: '', label: 'Your name' }),
      ),
    ).toEqual({ allowed: true });
    expect(judgeAction(action({ method: 'scrollTo' }), null)).toEqual({ allowed: true });
  });

  it('judges the real element, even when the AI describes it as harmless', () => {
    const verdict = judgeAction(
      action({ description: 'Save button' }),
      facts({ text: 'Delete account' }),
    );
    expect(verdict).toMatchObject({ allowed: false, kind: 'destructive' });
  });

  it('also refuses when only the AI’s own description sounds dangerous', () => {
    const verdict = judgeAction(
      action({ description: 'Trash icon that deletes the account' }),
      facts({ text: '' }),
    );
    expect(verdict).toMatchObject({ allowed: false, kind: 'destructive' });
  });

  it('reads aria-labels and titles of icon buttons', () => {
    expect(judgeAction(action(), facts({ text: '', label: 'Delete note' }))).toMatchObject({
      allowed: false,
    });
  });

  it('refuses when the element could not be read (fail closed)', () => {
    expect(judgeAction(action(), null)).toMatchObject({ allowed: false, kind: 'unverified' });
    expect(judgeAction(action({ method: 'fill', arguments: ['x'] }), null)).toMatchObject({
      allowed: false,
    });
  });

  it('refuses actions it does not know', () => {
    expect(judgeAction(action({ method: 'dragAndDrop' }), facts())).toMatchObject({
      allowed: false,
      kind: 'unsupported',
    });
    expect(judgeAction(action({ method: undefined }), facts())).toMatchObject({
      allowed: false,
      kind: 'unsupported',
    });
  });

  it('never types into payment fields and never types a card number anywhere', () => {
    const card = facts({
      tag: 'input',
      type: 'text',
      text: '',
      label: 'Card number',
      name: 'cardnumber card-number cc-number',
    });
    expect(judgeAction(action({ method: 'fill', arguments: ['1'] }), card)).toMatchObject({
      allowed: false,
      kind: 'payment',
    });
    expect(judgeAction(action({ method: 'click' }), card)).toMatchObject({
      allowed: false,
      kind: 'payment',
    });
    const note = facts({ tag: 'input', type: 'text', text: '', label: 'New note', name: 'note' });
    expect(
      judgeAction(action({ method: 'fill', arguments: ['4242 4242 4242 4242'] }), note),
    ).toMatchObject({ allowed: false, kind: 'payment' });
  });

  it('refuses to submit a form that contains payment fields, whatever its button says', () => {
    const button = facts({
      type: 'submit',
      text: 'Continue',
      formSubmitText: 'Continue',
      formHasPaymentField: true,
    });
    expect(judgeAction(action(), button)).toMatchObject({ allowed: false, kind: 'payment' });
  });

  it('treats Enter in a field like a click on the form’s submit button', () => {
    const field = facts({
      tag: 'input',
      type: 'text',
      text: '',
      label: 'Reason',
      formSubmitText: 'Delete account',
    });
    expect(judgeAction(action({ method: 'press', arguments: ['Enter'] }), field)).toMatchObject({
      allowed: false,
      kind: 'destructive',
    });
    const search = facts({
      tag: 'input',
      type: 'text',
      text: '',
      label: 'Search',
      formSubmitText: 'Search',
    });
    expect(judgeAction(action({ method: 'press', arguments: ['Enter'] }), search)).toEqual({
      allowed: true,
    });
  });

  it('refuses links whose address says delete, cancel or log out', () => {
    const link = (href: string, text = 'Open') =>
      judgeAction(action(), facts({ tag: 'a', text, href }));
    expect(link('https://myapp.example/account/delete', 'Danger zone')).toMatchObject({
      allowed: false,
      kind: 'destructive',
    });
    expect(link('https://myapp.example/subscription/cancel?now=1')).toMatchObject({
      allowed: false,
    });
    expect(link('https://myapp.example/auth/sign-out', 'Bye')).toMatchObject({ allowed: false });
    expect(link('https://myapp.example/api/logOut')).toMatchObject({ allowed: false });
  });

  it('allows opening a checkout page: the flow stops there by itself, with a note', () => {
    const link = (href: string) =>
      judgeAction(action(), facts({ tag: 'a', text: 'Upgrade to Pro', href }));
    expect(link('https://myapp.example/checkout.html')).toEqual({ allowed: true });
    expect(link('https://myapp.example/pricing')).toEqual({ allowed: true });
    expect(link('https://myapp.example/deleted-items')).toEqual({ allowed: true });
  });
});

describe('guard gaps (audit A-05): log out, send, archive and trash, icon-only buttons', () => {
  it.each([
    'Log out',
    'Logout',
    'Log Out',
    'Sign out',
    'Signout',
    'Logging out…',
    'Abmelden',
    'Ausloggen',
  ])('log out: %s', (text) => expect(kind(text)).toBe('log-out'));
  it.each(['Send', 'Send message', 'Senden', 'Absenden', 'Nachricht senden', 'Abschicken'])(
    'plain send: %s',
    (text) => expect(kind(text)).toBe('outward'),
  );
  it.each([
    'Archive project',
    'Archive',
    'Move to trash',
    'Trash',
    'Disable account',
    'Discard',
    'Disconnect',
    'Ban user',
    'Archivieren',
    'In den Papierkorb',
    'Deaktivieren',
  ])('destructive: %s', (text) => expect(kind(text)).toBe('destructive'));

  const contactFields = [
    { tag: 'input', type: 'text', keys: 'name contact-name', label: 'Your name' },
    { tag: 'input', type: 'email', keys: 'email contact-email email', label: 'Email' },
    { tag: 'textarea', type: 'textarea', keys: 'message contact-message', label: 'Message' },
  ];
  const submit = (
    text: string,
    formFields: ElementFacts['formFields'],
    more: Partial<ElementFacts> = {},
  ) => facts({ type: 'submit', text, formSubmitText: text, formFields, ...more });

  it('allows “Send message” on a contact form: the visitor writes to the app’s owner', () => {
    expect(
      judgeAction(
        action({ description: 'Send message button' }),
        submit('Send message', contactFields),
      ),
    ).toEqual({
      allowed: true,
    });
    expect(
      judgeAction(
        action({ method: 'press', arguments: ['Enter'] }),
        submit('Senden', contactFields, { type: 'text' }),
      ),
    ).toEqual({ allowed: true });
  });

  it.each([
    ['a chat box (only a message field)', contactFields.filter((f) => f.tag === 'textarea')],
    [
      'an email composer (a “To” field)',
      [
        { tag: 'input', type: 'email', keys: 'to', label: 'To' },
        { tag: 'input', type: 'text', keys: 'subject', label: 'Subject' },
        ...contactFields,
      ],
    ],
    [
      'a form with a recipient field',
      [...contactFields, { tag: 'input', type: 'text', keys: 'recipient', label: 'Recipient' }],
    ],
    ['no form at all', []],
  ])('refuses a plain “Send” in %s', (_name, formFields) => {
    const verdict = judgeAction(action(), submit('Send', formFields));
    expect(verdict).toMatchObject({ allowed: false, kind: 'outward' });
  });

  it('refuses log out, and says so in plain words', () => {
    expect(judgeAction(action(), facts({ text: 'Log out' }))).toMatchObject({
      allowed: false,
      kind: 'log-out',
      reason: expect.stringContaining('log the test account out'),
    });
  });

  it.each([
    ['a trash icon (Lucide)', { icons: 'trash-2' }, 'destructive'],
    ['a bin icon', { icons: 'bin' }, 'destructive'],
    ['an archive icon', { icons: 'archive' }, 'destructive'],
    ['a log-out icon', { icons: 'log-out' }, 'log-out'],
    ['a send icon', { icons: 'send' }, 'outward'],
    ['a paper-plane icon', { icons: 'paper-plane' }, 'outward'],
    ['id="delete-account"', { name: 'delete-account' }, 'destructive'],
    ['id="btnDeleteNote"', { name: 'btnDeleteNote' }, 'destructive'],
    ['data-testid="logout-button"', { name: 'logout-button' }, 'log-out'],
    ['an svg title “Delete” (read as its label)', { label: 'Delete' }, 'destructive'],
  ])('refuses an icon-only button with %s', (_name, more, expected) => {
    expect(judgeAction(action(), facts({ text: '', ...more }))).toMatchObject({
      allowed: false,
      kind: expected,
    });
  });

  it('refuses a button with no readable name at all: ShipCheck cannot tell what it does', () => {
    expect(judgeAction(action(), facts({ text: '' }))).toMatchObject({
      allowed: false,
      kind: 'unverified',
      reason: expect.stringContaining('no readable name'),
    });
  });

  it.each([
    ['a menu toggle without a label', { toggle: true }],
    ['a plus icon', { icons: 'plus' }],
    ['an id that says what it does', { name: 'add-note' }],
    ['a link (its address is checked instead)', { href: 'https://myapp.example/notes/42' }],
  ])('still allows an unnamed button with %s', (_name, more) => {
    expect(judgeAction(action(), facts({ text: '', ...more }))).toEqual({ allowed: true });
  });

  it('a link to a post is not “posting”', () => {
    expect(
      judgeAction(
        action(),
        facts({
          tag: 'a',
          text: 'Read more',
          name: 'post-42',
          href: 'https://myapp.example/posts/42',
        }),
      ),
    ).toEqual({ allowed: true });
  });
});
