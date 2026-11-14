import { describe, expect, it } from 'vitest';
import { createDomainLock } from '../../../src/browser/domain.js';
import type { PageLink } from '../../../src/checks/collect.js';
import {
  checkLinks,
  linkPlacement,
  selectLinkTargets,
  type LinkProbe,
  type LinkSelection,
  type LinkTarget,
} from '../../../src/checks/links.js';

const lock = createDomainLock('https://example.com/');
const bodyLink = (href: string, text = 'More'): PageLink => ({
  href,
  text,
  inNavigation: false,
  looksLikeButton: false,
});
const page = (
  links: (string | PageLink)[],
  images: string[] = [],
  url = 'https://example.com/',
) => ({
  url,
  links: links.map((link) => (typeof link === 'string' ? bodyLink(link) : link)),
  images: images.map((src) => ({ src, loaded: true })),
});

describe('selectLinkTargets', () => {
  it('keeps same-site links and images, once each, ignoring #fragments', () => {
    const selection = selectLinkTargets(
      [
        page(
          [
            'https://example.com/a',
            'https://example.com/a#top',
            'https://www.example.com/b',
            'https://example.com/#features',
          ],
          ['https://example.com/logo.png', 'https://example.com/logo.png'],
        ),
        page(['https://example.com/a', 'https://example.com/c'], [], 'https://example.com/a'),
      ],
      lock,
    );
    expect(selection.targets.map((t) => `${t.kind} ${t.url}`)).toEqual([
      'image https://example.com/logo.png',
      'link https://example.com/a',
      'link https://www.example.com/b',
      'link https://example.com/c',
    ]);
    expect(selection.targets[3]?.foundOn).toBe('https://example.com/a');
  });

  it('never selects other sites or non-web links', () => {
    const selection = selectLinkTargets(
      [
        page(
          ['https://twitter.com/me', 'mailto:hi@example.com', 'tel:+123', 'javascript:void(0)'],
          ['https://cdn.other.test/x.png', 'data:image/png;base64,AAAA'],
        ),
      ],
      lock,
    );
    expect(selection.targets).toEqual([]);
  });

  it('skips links that could change something, and counts them', () => {
    const selection = selectLinkTargets(
      [
        page([
          'https://example.com/logout',
          'https://example.com/account/delete',
          'https://example.com/ok',
        ]),
      ],
      lock,
    );
    expect(selection.targets.map((t) => t.url)).toEqual(['https://example.com/ok']);
    expect(selection.skippedForSafety).toBe(2);
  });

  it('a link that is also in the main menu counts as a menu link, wherever it was seen first', () => {
    const selection = selectLinkTargets(
      [
        page([bodyLink('https://example.com/pricing', 'see pricing')]),
        page(
          [{ ...bodyLink('https://example.com/pricing', 'Pricing'), inNavigation: true }],
          [],
          'https://example.com/a',
        ),
      ],
      lock,
    );
    expect(selection.targets).toEqual([
      {
        url: 'https://example.com/pricing',
        kind: 'link',
        foundOn: 'https://example.com/a',
        placement: 'navigation',
        text: 'Pricing',
      },
    ]);
  });

  it('stops at the cap and reports how many were left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => `https://example.com/p${i}`);
    const selection = selectLinkTargets([page(many)], lock);
    expect(selection.targets).toHaveLength(50);
    expect(selection.skippedOverCap).toBe(10);
  });
});

describe('linkPlacement', () => {
  it('header or main menu → navigation', () => {
    expect(
      linkPlacement({ ...bodyLink('https://example.com/pricing', 'Pricing'), inNavigation: true }),
    ).toBe('navigation');
  });

  it('sign up, log in, checkout and button-styled links → call-to-action', () => {
    expect(linkPlacement(bodyLink('https://example.com/x', 'Sign up free'))).toBe('call-to-action');
    expect(linkPlacement(bodyLink('https://example.com/x', 'Log in'))).toBe('call-to-action');
    expect(linkPlacement(bodyLink('https://example.com/x', 'Get started'))).toBe('call-to-action');
    expect(linkPlacement(bodyLink('https://example.com/checkout', 'Continue'))).toBe(
      'call-to-action',
    );
    expect(linkPlacement(bodyLink('https://example.com/register.html', 'here'))).toBe(
      'call-to-action',
    );
    expect(
      linkPlacement({
        ...bodyLink('https://example.com/tour', 'Take the tour'),
        looksLikeButton: true,
      }),
    ).toBe('call-to-action');
  });

  it('an ordinary link in the text or the footer → other', () => {
    expect(linkPlacement(bodyLink('https://example.com/blog/2024', 'our blog post'))).toBe('other');
    expect(linkPlacement(bodyLink('https://example.com/imprint', 'Imprint'))).toBe('other');
    // "login" inside a longer word is not a log-in link
    expect(linkPlacement(bodyLink('https://example.com/loginstructions', 'Logistics'))).toBe(
      'other',
    );
  });
});

describe('checkLinks', () => {
  const selection = (targets: LinkSelection['targets']): LinkSelection => ({
    targets,
    skippedForSafety: 0,
    skippedOverCap: 0,
  });
  const link = (url: string, placement: LinkTarget['placement'] = 'navigation', text?: string) => ({
    url,
    kind: 'link' as const,
    foundOn: 'https://example.com/',
    placement,
    ...(text ? { text } : {}),
  });
  const image = (url: string) => ({ url, kind: 'image' as const, foundOn: 'https://example.com/' });
  const prober = (answers: Record<string, Partial<Record<'HEAD' | 'GET', LinkProbe>>>) => {
    const calls: string[] = [];
    return {
      calls,
      probe: async (url: string, method: 'HEAD' | 'GET'): Promise<LinkProbe> => {
        calls.push(`${method} ${url}`);
        return answers[url]?.[method] ?? { status: 200 };
      },
    };
  };

  it('all fine → no findings', async () => {
    const { probe } = prober({});
    const result = await checkLinks(
      selection([link('https://example.com/a'), image('https://example.com/i.png')]),
      probe,
    );
    expect(result.findings).toEqual([]);
    expect(result.passed).toEqual(['2 links and images on your own site work']);
  });

  it('broken link → Major; broken image → Minor; grouped per kind', async () => {
    const dead = { HEAD: { status: 404 }, GET: { status: 404 } };
    const { probe } = prober({
      'https://example.com/gone': dead,
      'https://example.com/gone2': { HEAD: { status: 500 }, GET: { status: 500 } },
      'https://example.com/i.png': dead,
    });
    const result = await checkLinks(
      selection([
        link('https://example.com/gone'),
        link('https://example.com/gone2'),
        image('https://example.com/i.png'),
        link('https://example.com/ok'),
      ]),
      probe,
    );
    expect(result.findings.map((f) => [f.rule, f.severity])).toEqual([
      ['links/broken-link', 'major'],
      ['links/broken-image', 'minor'],
    ]);
    expect(result.findings[0]?.title).toBe(
      '2 links in your main menu lead to pages that do not exist',
    );
    expect(result.findings[0]?.evidence.logs).toHaveLength(2);
    expect(result.passed).toEqual(['1 links and images on your own site work']);
  });

  it('broken menu link or main button → Major; broken ordinary link → Minor (owner rule)', async () => {
    const dead = { HEAD: { status: 404 }, GET: { status: 404 } };
    const { probe } = prober({
      'https://example.com/pricing': dead,
      'https://example.com/signup': dead,
      'https://example.com/old-post': dead,
    });
    const result = await checkLinks(
      selection([
        link('https://example.com/pricing', 'navigation', 'Pricing'),
        link('https://example.com/signup', 'call-to-action', 'Get started'),
        link('https://example.com/old-post', 'other', 'last year’s post'),
      ]),
      probe,
    );
    expect(result.findings.map((f) => [f.rule, f.severity, f.title])).toEqual([
      [
        'links/broken-link',
        'major',
        '2 links in your main menu or main buttons lead to pages that do not exist',
      ],
      [
        'links/broken-other-link',
        'minor',
        'A link in your app leads to a page that does not exist',
      ],
    ]);
    expect(result.findings[0]?.evidence.logs).toEqual([
      '404 https://example.com/pricing (“Pricing” in the page header or main menu) — found on https://example.com/',
      '404 https://example.com/signup (“Get started”, a main button or sign-up/log-in link) — found on https://example.com/',
    ]);
    expect(result.findings[1]?.evidence.logs).toEqual([
      '404 https://example.com/old-post (“last year’s post”) — found on https://example.com/',
    ]);
  });

  it('only ordinary links broken → a single Minor finding, nothing Major', async () => {
    const { probe } = prober({
      'https://example.com/old': { HEAD: { status: 404 }, GET: { status: 404 } },
    });
    const result = await checkLinks(selection([link('https://example.com/old', 'other')]), probe);
    expect(result.findings.map((f) => f.severity)).toEqual(['minor']);
  });

  it('one broken menu link → Major, titled with its text', async () => {
    const { probe } = prober({
      'https://example.com/pricing': { HEAD: { status: 404 }, GET: { status: 404 } },
    });
    const result = await checkLinks(
      selection([link('https://example.com/pricing', 'navigation', 'Pricing')]),
      probe,
    );
    expect(result.findings.map((f) => [f.severity, f.title])).toEqual([
      ['major', 'The “Pricing” link in your main menu leads to a page that does not exist'],
    ]);
  });

  it('a server that refuses HEAD is re-checked with GET before calling the link broken', async () => {
    const { probe, calls } = prober({
      'https://example.com/a': { HEAD: { status: 405 }, GET: { status: 200 } },
    });
    const result = await checkLinks(selection([link('https://example.com/a')]), probe);
    expect(result.findings).toEqual([]);
    expect(calls).toEqual(['HEAD https://example.com/a', 'GET https://example.com/a']);
  });

  it('unclear answers are "not tested", never a finding', async () => {
    const unclear = { status: 0, inconclusive: true };
    const { probe } = prober({ 'https://example.com/a': { HEAD: unclear, GET: unclear } });
    const result = await checkLinks(selection([link('https://example.com/a')]), probe);
    expect(result.findings).toEqual([]);
    expect(result.notTested).toEqual(['1 links could not be checked (no clear answer)']);
  });

  it('mentions links skipped for safety and over the cap', async () => {
    const { probe } = prober({});
    const result = await checkLinks(
      { targets: [link('https://example.com/a')], skippedForSafety: 1, skippedOverCap: 7 },
      probe,
    );
    expect(result.notTested).toHaveLength(2);
    expect(result.notTested[0]).toMatch(/1 link was not opened, to be safe/);
  });
});
