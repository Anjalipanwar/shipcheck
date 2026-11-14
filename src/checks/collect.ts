import type { Page } from 'playwright';
import { z } from 'zod';

/** One link on a page. Placement decides how bad it is when the link is broken. */
export interface PageLink {
  /** Absolute address. */
  href: string;
  /** Visible text (or aria-label), shortened. */
  text: string;
  /** Inside the page header or the main navigation menu (not the footer). */
  inNavigation: boolean;
  /** Styled or marked up as a button (class "btn", "button", "cta" or role="button"). */
  looksLikeButton: boolean;
}

/** What we read from a page once, and then hand to the individual checks. */
export interface PageFacts {
  url: string;
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  h1Count: number;
  lang: string;
  hasFaviconLink: boolean;
  /** All links (<a href>), with where on the page they sit. */
  links: PageLink[];
  /** Absolute addresses of all images, and whether the browser managed to show them. */
  images: { src: string; loaded: boolean }[];
  /** Absolute addresses of external script files. */
  scripts: string[];
}

/*
 * The scripts below run inside the tested page. They are kept as plain text on purpose: when a
 * function is handed to the browser, build tools may rewrite it in ways that only work in Node.
 * Whatever comes back is treated as untrusted input and validated.
 */
const PAGE_FACTS_SCRIPT = `(() => {
  const meta = (selector) =>
    (document.querySelector(selector)?.getAttribute('content') ?? '').trim();
  const absolute = (value) => {
    if (!value) return null;
    try {
      return new URL(value, document.baseURI).toString();
    } catch {
      return null;
    }
  };
  return {
    url: location.href,
    title: document.title.trim(),
    metaDescription: meta('meta[name="description" i]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogImage: meta('meta[property="og:image"]'),
    h1Count: document.querySelectorAll('h1').length,
    lang: (document.documentElement.getAttribute('lang') ?? '').trim(),
    hasFaviconLink: document.querySelector('link[rel~="icon" i]') !== null,
    links: [...document.querySelectorAll('a[href]')]
      .map((a) => ({
        href: absolute(a.getAttribute('href')),
        text: ((a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim()).slice(0, 80),
        inNavigation:
          a.closest('header, nav, [role="navigation"], [role="banner"]') !== null &&
          a.closest('footer, [role="contentinfo"]') === null,
        looksLikeButton:
          a.getAttribute('role') === 'button' ||
          /(^|[\\s_-])(btn|button|cta)([\\s_-]|$)/i.test(a.getAttribute('class') || ''),
      }))
      .filter((link) => link.href !== null),
    images: [...document.querySelectorAll('img')]
      .map((img) => ({
        src: absolute(img.currentSrc || img.getAttribute('src')),
        loaded: img.complete && img.naturalWidth > 0,
      }))
      .filter((img) => img.src !== null),
    scripts: [...document.querySelectorAll('script[src]')]
      .map((s) => absolute(s.getAttribute('src')))
      .filter((src) => src !== null),
  };
})()`;

const PageFactsSchema = z.object({
  url: z.string(),
  title: z.string(),
  metaDescription: z.string(),
  ogTitle: z.string(),
  ogDescription: z.string(),
  ogImage: z.string(),
  h1Count: z.number(),
  lang: z.string(),
  hasFaviconLink: z.boolean(),
  links: z.array(
    z.object({
      href: z.string(),
      text: z.string(),
      inNavigation: z.boolean(),
      looksLikeButton: z.boolean(),
    }),
  ),
  images: z.array(z.object({ src: z.string(), loaded: z.boolean() })),
  scripts: z.array(z.string()),
});

export async function collectPageFacts(page: Page): Promise<PageFacts> {
  return PageFactsSchema.parse(await page.evaluate(PAGE_FACTS_SCRIPT));
}

export interface Timings {
  loadMs: number | null;
  lcpMs: number | null;
}

const TIMINGS_SCRIPT = `new Promise((resolve) => {
  const nav = performance.getEntriesByType('navigation')[0];
  const loadMs = nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null;
  let lcpMs = null;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcpMs = last.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => {
      observer.disconnect();
      resolve({ loadMs, lcpMs });
    }, 300);
  } catch {
    resolve({ loadMs, lcpMs });
  }
})`;

const TimingsSchema = z.object({ loadMs: z.number().nullable(), lcpMs: z.number().nullable() });

/** Reads the browser's own timing measurements for the current page. */
export async function collectTimings(page: Page): Promise<Timings> {
  return TimingsSchema.parse(await page.evaluate(TIMINGS_SCRIPT));
}

/** Rough count of the words a visitor (or a search engine without JavaScript) could read. */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}
