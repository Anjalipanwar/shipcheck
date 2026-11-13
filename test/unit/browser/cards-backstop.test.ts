import { describe, expect, it } from 'vitest';
import { decideRequest, isPaymentHost } from '../../../src/browser/backstop.js';
import { containsCardNumber, isCardNumber, luhnValid } from '../../../src/browser/cards.js';

// Published test numbers of the card brands — not real cards.
const VISA = '4242424242424242';
const MASTERCARD = '5555555555554444';
const AMEX = '378282246310005';

describe('card number recognition', () => {
  it('checks the Luhn checksum', () => {
    expect(luhnValid(VISA)).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('42a4')).toBe(false);
  });

  it('knows the common brands', () => {
    for (const number of [VISA, MASTERCARD, AMEX, '6011111111111117', '3530111333300000']) {
      expect(isCardNumber(number), number).toBe(true);
    }
  });

  it('finds a card number however it is written or packed', () => {
    expect(containsCardNumber(`card=${VISA}`)).toBe(true);
    expect(containsCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(containsCardNumber('4242-4242-4242-4242')).toBe(true);
    expect(containsCardNumber(JSON.stringify({ cardNumber: '5555 5555 5555 4444' }))).toBe(true);
    expect(containsCardNumber('number=4242+4242+4242+4242&cvc=123')).toBe(true);
    expect(containsCardNumber('number=4242%204242%204242%204242')).toBe(true);
    expect(containsCardNumber(`{"n":${AMEX}}`)).toBe(true);
  });

  it('does not mistake other long numbers for cards', () => {
    expect(containsCardNumber('1731520671039')).toBe(false); // time in milliseconds
    expect(containsCardNumber('1731520671039000')).toBe(false); // time in microseconds
    expect(containsCardNumber('4242424242424241')).toBe(false); // right shape, wrong checksum
    expect(containsCardNumber('9999999999999995')).toBe(false); // passes the checksum, no brand
    expect(containsCardNumber(`1${VISA}`)).toBe(false); // part of a longer number
    expect(containsCardNumber('phone +49 170 1234567, order 12345')).toBe(false);
    expect(containsCardNumber('placeholder 1234 1234 1234 1234')).toBe(false);
    expect(containsCardNumber('')).toBe(false);
    expect(containsCardNumber(null)).toBe(false);
  });
});

describe('payment hosts', () => {
  it('recognises providers and their subdomains only', () => {
    for (const host of [
      'stripe.com',
      'api.stripe.com',
      'js.stripe.com',
      'm.stripe.network',
      'www.paypal.com',
      'API.Stripe.com',
    ]) {
      expect(isPaymentHost(host), host).toBe(true);
    }
    for (const host of [
      'mystripe.com',
      'stripe.com.evil.example',
      'paypal.example.com',
      'example.com',
    ]) {
      expect(isPaymentHost(host), host).toBe(false);
    }
  });
});

describe('backstop decisions', () => {
  const request = (
    method: string,
    url: string,
    postData: string | null = null,
    resourceType = 'fetch',
  ) => decideRequest({ url, method, resourceType, postData });

  it('blocks every request to a payment provider except loading its script', () => {
    expect(request('POST', 'https://api.stripe.com/v1/payment_intents')).toBe('payment-host');
    expect(
      request('GET', 'https://js.stripe.com/v3/elements-inner-card.html', null, 'document'),
    ).toBe('payment-host');
    expect(request('GET', 'https://checkout.stripe.com/c/pay/cs_test_1', null, 'document')).toBe(
      'payment-host',
    );
    expect(request('POST', 'https://www.paypal.com/smart/buttons')).toBe('payment-host');
    expect(request('GET', 'https://js.stripe.com/v3/', null, 'script')).toBeNull();
    expect(request('GET', 'https://www.paypal.com/sdk/js?client-id=x', null, 'script')).toBeNull();
  });

  it('blocks any request that carries a card number, wherever it goes', () => {
    expect(request('POST', 'https://myapp.example/api/save', `{"cardNumber":"${VISA}"}`)).toBe(
      'card-number',
    );
    expect(request('GET', `https://myapp.example/track?c=${VISA}`)).toBe('card-number');
    expect(request('GET', `https://js.stripe.com/v3/?n=${VISA}`, null, 'script')).toBe(
      'card-number',
    );
    expect(
      request('POST', 'https://unknown-psp.example/tokenize', 'number=4242+4242+4242+4242'),
    ).toBe('card-number');
  });

  it('blocks data-changing requests that delete, cancel or pay', () => {
    expect(request('POST', 'https://myapp.example/api/delete-account')).toBe('destructive-request');
    expect(request('POST', 'https://myapp.example/api/deleteAccount')).toBe('destructive-request');
    expect(request('POST', 'https://myapp.example/api/checkout')).toBe('destructive-request');
    expect(request('PUT', 'https://myapp.example/subscription/cancel')).toBe('destructive-request');
    expect(request('POST', 'https://myapp.example/api/team/invite')).toBe('destructive-request');
    expect(request('POST', 'https://myapp.example/konto/löschen')).toBe('destructive-request');
    expect(request('DELETE', 'https://myapp.example/api/notes/12')).toBe('destructive-request');
    expect(request('DELETE', 'https://abc.supabase.co/rest/v1/notes?id=eq.1')).toBe(
      'destructive-request',
    );
  });

  it('lets ordinary requests through', () => {
    expect(request('GET', 'https://myapp.example/checkout')).toBeNull(); // viewing a page is fine
    expect(request('GET', 'https://myapp.example/account/delete', null, 'document')).toBeNull();
    expect(
      request('POST', 'https://myapp.example/api/signup', '{"email":"a@example.com"}'),
    ).toBeNull();
    expect(request('POST', 'https://myapp.example/api/login')).toBeNull();
    expect(request('POST', 'https://myapp.example/api/contact', '{"name":"x"}')).toBeNull();
    expect(request('POST', 'https://myapp.example/api/notes', '{"t":1731520671039}')).toBeNull();
    expect(request('POST', 'https://myapp.example/api/reorder-list')).toBeNull();
    expect(request('PATCH', 'https://abc.supabase.co/rest/v1/notes?id=eq.1')).toBeNull();
    expect(request('GET', 'data:text/plain,hello')).toBeNull();
    expect(request('GET', 'not a url')).toBeNull();
  });
});
