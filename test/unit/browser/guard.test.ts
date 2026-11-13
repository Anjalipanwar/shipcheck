import { describe, expect, it } from 'vitest';
import { isRiskyUrl } from '../../../src/browser/guard.js';

describe('isRiskyUrl', () => {
  it.each([
    'https://example.com/logout',
    'https://example.com/auth/sign-out',
    'https://example.com/account/delete',
    'https://example.com/items/42/remove',
    'https://example.com/newsletter/unsubscribe?u=1',
    'https://example.com/subscription/cancel',
    'https://example.com/email/verify?token=abc',
    'https://example.com/reset?code=123',
    'https://example.com/checkout/pay',
    'https://example.com/api/export',
    'https://example.com/konto/löschen',
    'https://example.com/konto/l%C3%B6schen',
    'https://example.com/abo/kuendigen',
    'https://example.com/Logout',
    'https://example.com/page?action=delete',
    'https://example.com/join?invite=xyz',
    'not a url',
  ])('%s is risky', (url) => {
    expect(isRiskyUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://example.com/pricing',
    'https://example.com/features.html',
    'https://example.com/blog/how-to-restart-your-router',
    'https://example.com/payments-explained',
    'https://example.com/orders-guide',
    'https://example.com/login',
    'https://example.com/signup',
    'https://example.com/contact?topic=sales',
    'https://example.com/docs/removal-policy',
  ])('%s is safe', (url) => {
    expect(isRiskyUrl(url)).toBe(false);
  });
});
