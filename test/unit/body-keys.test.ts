import { describe, expect, it } from 'vitest';
import { bodyKeys, carriesTypedValue, isFormRequest } from '../../src/browser/body-keys.js';

describe('bodyKeys: field names of a request body, never the values', () => {
  it('JSON, also nested', () => {
    expect(bodyKeys('{"name":"Ann","email":"a@b.c","meta":{"source":"web"}}')).toEqual([
      'name',
      'email',
      'meta',
      'source',
    ]);
  });
  it('classic form bodies and multipart bodies', () => {
    expect(bodyKeys('name=Ann&email=a%40b.c&message=')).toEqual(['name', 'email', 'message']);
    expect(
      bodyKeys(
        '--x\r\nContent-Disposition: form-data; name="1_email"\r\n\r\na@b.c\r\n--x\r\nContent-Disposition: form-data; name="1_message"\r\n\r\nhi\r\n--x--',
      ),
    ).toEqual(['1_email', '1_message']);
  });
  it('no body, plain text or broken JSON → no keys; values never leak into the result', () => {
    expect(bodyKeys(null)).toEqual([]);
    expect(bodyKeys('')).toEqual([]);
    expect(bodyKeys('hello world')).toEqual([]);
    expect(bodyKeys('{"password":"Zebra-Lamp-4471!"}')).toEqual(['password']);
  });
});

describe('isFormRequest: the form’s own request, or something else sent by the same click?', () => {
  const form = ['name', 'contact-name', 'email', 'contact-email', 'message'];
  const at = (url: string, keys: string[]) => ({ url, bodyKeys: keys });

  it('a request that names one of the form’s fields is the form’s', () => {
    expect(isFormRequest(at('https://a.app/api/contact', ['name', 'email', 'message']), form)).toBe(
      true,
    );
    expect(isFormRequest(at('https://a.app/', ['1_email', '1_message', '$ACTION_ID']), form)).toBe(
      true,
    );
    expect(isFormRequest(at('https://a.app/api/x', ['contactName']), form)).toBe(true);
  });
  it('a tracking beacon is not — whatever its address and status', () => {
    expect(isFormRequest(at('https://a.app/api/track', ['event']), form)).toBe(false);
    expect(isFormRequest(at('https://a.app/~api/analytics', ['t', 'sid', 'path']), form)).toBe(
      false,
    );
    expect(isFormRequest(at('https://a.app/save', ['event', 'ts']), form)).toBe(false);
  });
  it('nothing to compare (no field names, or an unreadable body): only tracking-like addresses are ruled out', () => {
    expect(isFormRequest(at('https://a.app/api/contact', []), form)).toBe(true);
    expect(isFormRequest(at('https://a.app/api/contact', ['x']), [])).toBe(true);
    expect(isFormRequest(at('https://a.app/api/track', []), form)).toBe(false);
    expect(isFormRequest(at('https://a.app/_vercel/insights/event', []), [])).toBe(false);
    expect(isFormRequest(at('https://a.app/api/eventbooking', []), [])).toBe(true);
  });
});

describe('carriesTypedValue: after ShipCheck typed something, the form’s request is the one that carries it', () => {
  it('a request with the typed value is the form’s; an analytics event with a “name” is not', () => {
    expect(
      carriesTypedValue({ url: 'https://a.app/api/contact', bodyKeys: ['x'], echoes: true }),
    ).toBe(true);
    expect(
      carriesTypedValue({
        url: 'https://a.app/__l/trackevents',
        bodyKeys: ['events', 'name', 'email', 'ts'],
        echoes: false,
      }),
    ).toBe(false);
    expect(
      carriesTypedValue({ url: 'https://a.app/save', bodyKeys: ['name'], echoes: false }),
    ).toBe(false);
  });
  it('a body that could not be read: only the address can decide', () => {
    expect(carriesTypedValue({ url: 'https://a.app/api/contact', bodyKeys: [] })).toBe(true);
    expect(carriesTypedValue({ url: 'https://a.app/__l/trackevents', bodyKeys: [] })).toBe(false);
  });
  it('“trackevents”, “tracking”, “tracker” are tracking addresses; “/login” is not', () => {
    for (const path of ['/__l/trackevents', '/tracking', '/api/tracker', '/v1/events']) {
      expect(isFormRequest({ url: `https://a.app${path}`, bodyKeys: [] }, []), path).toBe(false);
    }
    for (const path of ['/login', '/api/signup', '/auth/v1/signup', '/api/racetrack-booking']) {
      expect(isFormRequest({ url: `https://a.app${path}`, bodyKeys: [] }, []), path).toBe(true);
    }
  });
});
