import { makeFinding, type Finding } from '../report/schema.js';
import type { PageFacts } from './collect.js';
import type { CheckResult } from './types.js';

/** Below this many characters of readable text, the page is an "empty shell" without JavaScript. */
export const EMPTY_SHELL_MAX_CHARS = 200;

export interface SeoFacts {
  page: Pick<
    PageFacts,
    | 'url'
    | 'title'
    | 'metaDescription'
    | 'ogTitle'
    | 'ogDescription'
    | 'ogImage'
    | 'h1Count'
    | 'lang'
    | 'hasFaviconLink'
  >;
  /** /favicon.ico exists (fallback when the page has no icon link). null = could not check. */
  faviconIcoExists: boolean | null;
  robotsTxtExists: boolean | null;
  sitemapXmlExists: boolean | null;
  /** Characters of readable text in the page as delivered, before any JavaScript runs. */
  rawTextLength: number | null;
}

export function checkSeo(facts: SeoFacts): CheckResult {
  const { page } = facts;
  const findings: Finding[] = [];
  const passed: string[] = [];
  const notTested: string[] = [];

  const issue = (input: {
    rule: string;
    title: string;
    whatHappened: string;
    whyItMatters: string;
    log: string;
    fixPrompt: string;
  }) =>
    findings.push(
      makeFinding({
        rule: `seo/${input.rule}`,
        title: input.title,
        severity: 'minor',
        category: 'seo',
        device: 'both',
        whatHappened: input.whatHappened,
        whyItMatters: input.whyItMatters,
        stepsToReproduce: [
          `Open ${page.url}.`,
          'Right-click the page and choose “View page source”.',
        ],
        evidence: { screenshots: [], logs: [input.log], url: page.url },
        fixPrompt: input.fixPrompt,
        confidence: 'verified',
      }),
    );

  if (page.title) passed.push('Home page has a title');
  else
    issue({
      rule: 'missing-title',
      title: 'Your home page has no title',
      whatHappened: 'The home page does not set a page title.',
      whyItMatters:
        'The title is the headline shown in Google results and on the browser tab. Without it, your app shows up as a bare web address.',
      log: 'No <title> found on the home page',
      fixPrompt:
        'Add a clear, specific <title> (50–60 characters) to my landing page that says what the app does and includes its name.',
    });

  if (page.metaDescription) passed.push('Home page has a description for search results');
  else
    issue({
      rule: 'missing-description',
      title: 'Your home page has no description for search results',
      whatHappened:
        'The home page does not include the short summary that search engines show under the title.',
      whyItMatters:
        'Without it, Google picks random text from the page, which usually reads badly and gets fewer clicks.',
      log: 'No <meta name="description"> found on the home page',
      fixPrompt:
        'Add a <meta name="description"> tag to my landing page: one or two sentences (max 155 characters) that explain what the app does and who it is for.',
    });

  const missingOg = [
    ...(page.ogTitle ? [] : ['og:title']),
    ...(page.ogDescription ? [] : ['og:description']),
    ...(page.ogImage ? [] : ['og:image']),
  ];
  if (missingOg.length === 0) passed.push('Links to your app show a preview when shared');
  else
    issue({
      rule: 'missing-open-graph',
      title: 'Links to your app show no preview when shared',
      whatHappened: `The home page is missing the tags that create a preview card (title, text, picture) when someone shares your link on WhatsApp, LinkedIn, X or Slack. Missing: ${missingOg.join(', ')}.`,
      whyItMatters:
        'A bare link gets far fewer clicks than one with a picture and headline — and launches mostly spread through shared links.',
      log: `Missing Open Graph tags: ${missingOg.join(', ')}`,
      fixPrompt: `Add Open Graph tags to my landing page's <head>: ${missingOg.join(', ')}${missingOg.includes('og:image') ? ' (image 1200×630 px, absolute URL)' : ''}. Also add twitter:card "summary_large_image".`,
    });

  if (page.h1Count === 1) passed.push('Home page has one main heading');
  else
    issue({
      rule: page.h1Count === 0 ? 'missing-h1' : 'multiple-h1',
      title:
        page.h1Count === 0
          ? 'Your home page has no main heading'
          : `Your home page has ${page.h1Count} main headings instead of one`,
      whatHappened:
        page.h1Count === 0
          ? 'No part of the home page is marked as its main heading.'
          : `${page.h1Count} different parts of the home page are marked as its main heading.`,
      whyItMatters:
        'Search engines and screen readers use the main heading to understand what the page is about. Exactly one works best.',
      log: `Number of <h1> headings on the home page: ${page.h1Count}`,
      fixPrompt:
        'Make sure my landing page has exactly one <h1> that states what the app does. Change any other <h1> elements to <h2> or lower without changing how they look.',
    });

  if (page.lang) passed.push('Home page states its language');
  else
    issue({
      rule: 'missing-lang',
      title: 'Your home page does not say which language it is written in',
      whatHappened: 'The page does not declare its language.',
      whyItMatters:
        'Screen readers may read the text with the wrong pronunciation, and browsers may offer to translate it when they shouldn’t.',
      log: 'No lang attribute on the <html> element',
      fixPrompt:
        'Add the correct lang attribute to the <html> element of my app (for example lang="en" or lang="de").',
    });

  if (page.hasFaviconLink || facts.faviconIcoExists === true)
    passed.push('App has a browser-tab icon');
  else if (facts.faviconIcoExists === null) notTested.push('Browser-tab icon — could not check');
  else
    issue({
      rule: 'missing-favicon',
      title: 'Your app has no browser-tab icon',
      whatHappened:
        'No small icon (“favicon”) is set, so browser tabs and bookmarks show a blank placeholder.',
      whyItMatters: 'It makes the app look unfinished and harder to find among open tabs.',
      log: 'No <link rel="icon"> on the home page and no /favicon.ico',
      fixPrompt:
        'Add a favicon to my app (SVG or 32×32 PNG) and link it in the <head> with <link rel="icon">.',
    });

  if (facts.robotsTxtExists === true) passed.push('robots.txt file exists');
  else if (facts.robotsTxtExists === null) notTested.push('robots.txt — could not check');
  else
    issue({
      rule: 'missing-robots-txt',
      title: 'Your app has no robots.txt file',
      whatHappened:
        'There is no “robots.txt” file — the small file that tells search engines which pages they may read.',
      whyItMatters:
        'Search engines still work without it, but it is the standard place to point them to your list of pages.',
      log: 'GET /robots.txt did not return a file',
      fixPrompt:
        'Add a robots.txt file at the root of my app that allows all crawlers on public pages and includes a "Sitemap:" line pointing to /sitemap.xml.',
    });

  if (facts.sitemapXmlExists === true) passed.push('sitemap.xml file exists');
  else if (facts.sitemapXmlExists === null) notTested.push('sitemap.xml — could not check');
  else
    issue({
      rule: 'missing-sitemap',
      title: 'Your app has no sitemap',
      whatHappened:
        'There is no “sitemap.xml” file — the list of your pages that search engines read.',
      whyItMatters: 'Without it, search engines can take longer to find all your pages.',
      log: 'GET /sitemap.xml did not return a file',
      fixPrompt:
        'Generate a sitemap.xml at the root of my app that lists all public pages with absolute URLs.',
    });

  if (facts.rawTextLength === null)
    notTested.push('What search engines see without JavaScript — could not fetch the page');
  else if (facts.rawTextLength >= EMPTY_SHELL_MAX_CHARS)
    passed.push('Page content is readable without JavaScript');
  else
    issue({
      rule: 'empty-shell',
      title: 'Search engines and AI assistants may see a blank page',
      whatHappened: `Before its code runs, your home page contains almost no readable text (${facts.rawTextLength} characters). The content only appears after JavaScript has run in a browser.`,
      whyItMatters:
        'Many search engines, link previews and AI assistants do not run JavaScript. To them your app looks empty, so it may not show up in results.',
      log: `Readable text in the page as delivered (no JavaScript): ${facts.rawTextLength} characters (expected at least ${EMPTY_SHELL_MAX_CHARS})`,
      fixPrompt:
        'My landing page is rendered only by client-side JavaScript, so crawlers see an empty page. Please make the landing page content available in the initial HTML — use server-side rendering or static pre-rendering for the public pages.',
    });

  return { findings, passed, notTested };
}
