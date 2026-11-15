import { describe, expect, it } from 'vitest';
import { safeDismissKind } from '../../../src/checks/mobile-banner.js';

/** Owner decision 2026-11-15: close a covering banner with a safe choice only, never consent. */
describe('safeDismissKind', () => {
  it.each([
    [['Reject all'], 'reject'],
    [['Decline'], 'reject'],
    [['Alle ablehnen'], 'reject'],
    [['Only necessary'], 'necessary'],
    [['Only necessary cookies'], 'necessary'],
    [['Use necessary cookies only'], 'necessary'],
    [['Nur notwendige Cookies'], 'necessary'],
    [['Close'], 'close'],
    [['×'], 'close'],
    [['✕', 'Close cookie banner'], 'close'],
    [['Schließen'], 'close'],
    [['', 'Dismiss'], 'close'],
  ] as const)('%j → %s', (names, kind) => {
    expect(safeDismissKind(names)).toBe(kind);
  });

  it.each([
    [['Accept all']],
    [['Accept']],
    [['Akzeptieren']],
    [['Alle akzeptieren']],
    [['I agree']],
    [['Allow all cookies']],
    [['Got it']],
    [['OK']],
    [['Einverstanden']],
    // Safe-looking text, but another name of the same button gives consent: never tapped.
    [['Close', 'Accept and close']],
    [['×', 'Accept cookies']],
    [['Accept & close']],
    // Not a banner choice at all.
    [['Close account']],
    [['Close my account']],
    [['Settings']],
    [['Manage preferences']],
    [['Sign up']],
    [[]],
    [['   ']],
  ])('%j → never tapped', (names) => {
    expect(safeDismissKind(names)).toBeNull();
  });
});
