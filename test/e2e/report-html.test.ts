import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { writeReport, type WrittenReport } from '../../src/report/write.js';
import { runShipCheck } from '../../src/runner.js';
import { startFixtureServer } from '../helpers/fixture-server.js';

/**
 * Opens the report.html of a real --no-ai run against the buggy fixture app in a real browser
 * and tests it the way ShipCheck tests other people's apps.
 */
const PASSWORD = 'e2e-Secret-Pass-123';
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

let outDir: string;
let written: WrittenReport;
let browser: Browser;
let context: BrowserContext | undefined;
let problems: string[];
let requests: string[];

beforeAll(async () => {
  const app = await startFixtureServer();
  try {
    outDir = await mkdtemp(join(tmpdir(), 'shipcheck-report-'));
    const config = loadConfig(
      app.url,
      { ai: false, yes: true, out: outDir },
      { SHIPCHECK_PASSWORD: PASSWORD },
    );
    const result = await runShipCheck(config);
    written = await writeReport(outDir, result.report, result.screenshots, result.redact);
  } finally {
    await app.close(); // the report must work with the app gone (offline)
  }
  browser = await chromium.launch();
});

afterEach(async () => {
  await context?.close();
  context = undefined;
});

afterAll(async () => {
  await browser.close();
  await rm(outDir, { recursive: true, force: true });
});

async function open(
  viewport: { width: number; height: number },
  options: { colorScheme?: 'light' | 'dark'; javaScriptEnabled?: boolean } = {},
): Promise<Page> {
  context = await browser.newContext({
    viewport,
    colorScheme: options.colorScheme ?? 'light',
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  problems = [];
  requests = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(pathToFileURL(written.htmlPath).href, { waitUntil: 'load' });
  return page;
}

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

describe('report.html from a real run', () => {
  it('is written next to report.json and report.md and is far below 5 MB', async () => {
    expect((await stat(written.htmlPath)).size).toBeLessThan(5_000_000);
    expect((await stat(written.htmlPath)).size).toBeGreaterThan(20_000);
    expect((await stat(written.markdownPath)).size).toBeGreaterThan(2_000);
  });

  it('opens offline without errors and without asking the network for anything', async () => {
    const page = await open(DESKTOP);
    expect(problems).toEqual([]);
    expect(requests.filter((url) => !url.startsWith('data:'))).toEqual([
      pathToFileURL(written.htmlPath).href,
    ]);
    await expect(page.title()).resolves.toMatch(
      /^ShipCheck report — Automatic checks found issues — 127\.0\.0\.1/,
    );
  });

  it('shows the verdict, the counts and the nine findings of the fixture app (no-AI run, phone layout included)', async () => {
    const page = await open(DESKTOP);
    expect(await page.locator('.verdict .big').innerText()).toBe('Automatic checks found issues');
    // The coverage box is right under the verdict, open, and readable without hovering.
    const box = page.locator('.verdict + .coverage');
    expect(await box.isVisible()).toBe(true);
    expect(await box.locator('.check-type').innerText()).toBe('Automatic checks only (no AI)');
    expect(await box.locator('tr.st-not-tested td').first().innerText()).toBe(
      '○ Not tested: this needs the full check',
    );
    expect(await box.locator('tbody tr:not(.group)').count()).toBe(11);
    expect(await box.locator('tr.group').allInnerTexts()).toEqual([
      'Using your app like a visitor (full check only)',
      'Automatic checks (always run)',
    ]);
    // A row with problems links to its worst finding.
    const target = await box.locator('tr.st-problems a').first().getAttribute('href');
    expect(await page.locator(`${target ?? '#none'}`).count()).toBe(1);
    expect(await page.locator('.verdict .legend').innerText()).toContain('Blocker = stops people');
    expect(await page.locator('.counts li').allInnerTexts()).toEqual([
      '1 Blocker',
      '1 Major',
      '6 Minor',
      '1 Info',
    ]);
    expect(await page.locator('article.card').count()).toBe(9);
    expect(await page.locator('ol.first a').allInnerTexts()).toEqual([
      'A secret key is visible to anyone who visits your app (Stripe secret key)',
      'The “Pricing” link in your main menu leads to a page that does not exist',
      '4 recommended security settings are switched off',
    ]);
    expect(await page.locator('main h3').allInnerTexts()).toEqual([
      'MOBILE',
      'ACROSS THE APP',
      'SECURITY',
      'SEARCH AND SHARING (SEO)',
      'HIDDEN ERRORS',
    ]);
    expect(await page.locator('ul.worked li').count()).toBeGreaterThanOrEqual(10);
    expect(await page.locator('ul.skipped').innerText()).toMatch(/need the full check/);
  });

  it('"fix these first" jumps to the matching issue card', async () => {
    const page = await open(DESKTOP);
    await page.locator('ol.first a').first().click();
    const card = page.locator('article.card:target');
    await expect(card.locator('h4').innerText()).resolves.toMatch(/secret key is visible/);
    expect(await card.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(200);
  });

  it('copy button puts exactly the fix prompt on the clipboard and says so', async () => {
    const page = await open(DESKTOP);
    const card = page.locator('article.card', { hasText: 'secret key is visible' });
    const button = card.getByRole('button', { name: /^Copy fix prompt/ });
    await button.click();
    await expect.poll(() => button.innerText()).toBe('Copied');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(await card.locator('.fix pre').innerText());
    expect(clipboard).toMatch(/^A Stripe secret key \(starting with "sk_liv"\)/);
    expect(await page.locator('#status').innerText()).toBe('Fix prompt copied');
  });

  it('screenshot opens enlarged and closes with the button and with Escape', async () => {
    const page = await open(DESKTOP);
    const dialog = page.locator('dialog#lightbox');
    await expect(dialog.isVisible()).resolves.toBe(false);
    await page.getByRole('button', { name: /^Enlarge screenshot: home page/ }).click();
    await expect(dialog.isVisible()).resolves.toBe(true);
    expect(await dialog.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
      1280,
    );
    expect(await dialog.locator('.caption').innerText()).toBe('Screenshot: home page (desktop)');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog.isVisible()).resolves.toBe(false);

    await page
      .getByRole('button', { name: /^Enlarge screenshot/ })
      .first()
      .click();
    await page.keyboard.press('Escape');
    await expect(dialog.isVisible()).resolves.toBe(false);
  });

  it('technical details are collapsed until opened', async () => {
    const page = await open(DESKTOP);
    const details = page.locator('article.card details').first();
    await expect(details.locator('pre').isVisible()).resolves.toBe(false);
    await details.locator('summary').click();
    await expect(details.locator('pre').isVisible()).resolves.toBe(true);
  });

  it.each([
    ['desktop, light', DESKTOP, 'light'],
    ['desktop, dark', DESKTOP, 'dark'],
    ['phone, light', PHONE, 'light'],
    ['phone, dark', PHONE, 'dark'],
  ] as const)(
    'has no serious accessibility problems (%s)',
    async (_name, viewport, colorScheme) => {
      const page = await open(viewport, { colorScheme });
      await page.locator('article.card details summary').first().click();
      expect(await seriousViolations(page)).toEqual([]);
      await page
        .getByRole('button', { name: /^Enlarge screenshot/ })
        .first()
        .click();
      expect(await seriousViolations(page)).toEqual([]);
    },
  );

  it('really switches to dark colours when the reader’s device prefers them', async () => {
    const background = (page: Page) =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await background(await open(DESKTOP))).toBe('rgb(245, 246, 248)');
    await context?.close();
    expect(await background(await open(DESKTOP, { colorScheme: 'dark' }))).toBe('rgb(18, 21, 27)');
  });

  it('fits a phone screen: no sideways scrolling, tap targets big enough', async () => {
    const page = await open(PHONE);
    await page.locator('article.card details summary').first().click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    for (const box of await page
      .locator('button.copy')
      .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(40);
    }
  });

  it('stays readable with JavaScript switched off, and hides controls that need it', async () => {
    const page = await open(DESKTOP, { javaScriptEnabled: false });
    expect(await page.locator('article.card').count()).toBe(9);
    await expect(page.locator('.fix pre').first().isVisible()).resolves.toBe(true);
    await expect(page.locator('button.copy').first().isVisible()).resolves.toBe(false);
    await expect(page.locator('.shot img').first().isVisible()).resolves.toBe(true);
  });

  it('contains no password and no unmasked secret key, in any of the three files', async () => {
    for (const path of [written.htmlPath, written.markdownPath, written.jsonPath]) {
      const text = await readFile(path, 'utf8');
      expect(text, path).not.toContain(PASSWORD);
      expect(text, path).not.toContain('FAKEshipcheckFIXTURE');
      expect(text, path).toContain('sk_liv…eal1');
    }
  });
});
