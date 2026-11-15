import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { BACKSTOP_REASON_TEXT, installBackstop } from './backstop.js';
import { withShipCheckSuffix, type DevicePreset } from './devices.js';
import { createDomainLock, decideRoute, type DomainLock } from './domain.js';
import { Evidence } from './evidence.js';
import { isMissingBrowser, missingBrowserError } from './missing-browser.js';

export interface SessionOptions {
  targetUrl: string;
  headed?: boolean;
  evidence?: Evidence;
  /**
   * Local port for the browser's remote-control connection, which the AI layer attaches to.
   * Only opened for runs that use AI; it listens on this computer only.
   */
  cdpPort?: number;
}

export interface DevicePage {
  device: DevicePreset;
  context: BrowserContext;
  page: Page;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;

/**
 * Installs the domain lock (SPEC §7.1) on a browser context.
 * A blocked navigation is answered with an empty "204 No Content" reply: the browser then
 * simply stays on the page it was on, and the outside site is never contacted.
 */
export async function installDomainLock(
  context: BrowserContext,
  lock: DomainLock,
  onBlocked: (url: string, pageUrl: string) => void,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    let isTopFrame = false;
    let pageUrl = '';
    if (request.isNavigationRequest()) {
      try {
        const frame = request.frame();
        isTopFrame = frame.parentFrame() === null;
        pageUrl = frame.page().url();
      } catch {
        // A brand-new tab or popup has no frame yet — that is always a top-level navigation.
        isTopFrame = true;
      }
    }
    const decision = decideRoute(
      { url: request.url(), isNavigation: request.isNavigationRequest(), isTopFrame },
      lock,
    );
    if (decision === 'block') {
      onBlocked(request.url(), pageUrl);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fallback();
  });
}

/**
 * One browser for the whole run. Playwright owns the browser and its contexts, so the domain
 * lock, the evidence listeners and device emulation apply to every page, popups included.
 */
export class BrowserSession {
  private constructor(
    readonly browser: Browser,
    readonly lock: DomainLock,
    readonly evidence: Evidence,
    /** The browser's own user agent with the ShipCheck suffix. */
    readonly desktopUserAgent: string,
  ) {}

  static async launch(options: SessionOptions): Promise<BrowserSession> {
    const lock = createDomainLock(options.targetUrl);
    const browser = await chromium
      .launch({
        headless: !options.headed,
        args: options.cdpPort
          ? [`--remote-debugging-port=${options.cdpPort}`, '--remote-debugging-address=127.0.0.1']
          : [],
      })
      .catch((error: unknown) => {
        // First run on a new computer: say how to install the browser, in plain words.
        throw isMissingBrowser(error) ? missingBrowserError() : error;
      });
    try {
      const cdp = await browser.newBrowserCDPSession();
      const { userAgent } = await cdp.send('Browser.getVersion');
      await cdp.detach();
      return new BrowserSession(
        browser,
        lock,
        options.evidence ?? new Evidence(),
        withShipCheckSuffix(userAgent),
      );
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  userAgentFor(device: DevicePreset): string {
    return device.userAgent ? withShipCheckSuffix(device.userAgent) : this.desktopUserAgent;
  }

  /** Opens a fresh, isolated browser context for a device, with lock and listeners in place. */
  async open(device: DevicePreset): Promise<DevicePage> {
    const context = await this.browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      userAgent: this.userAgentFor(device),
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    await installDomainLock(context, this.lock, (url, pageUrl) =>
      this.evidence.recordBlockedNavigation(device.name, pageUrl, url),
    );
    // Added after the domain lock, so it is asked first: nothing gets past the backstop.
    await installBackstop(context, (reason, request, pageUrl, browserRequest) =>
      this.evidence.recordBlockedRequest(
        device.name,
        pageUrl,
        {
          url: request.url,
          method: request.method,
          reason: BACKSTOP_REASON_TEXT[reason],
          cause: reason,
          topLevel: request.topLevel,
        },
        browserRequest,
      ),
    );
    this.evidence.attach(context, device.name);
    const page = await context.newPage();
    return { device, context, page };
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => undefined);
  }
}

/** Opens a page, trying a second time if the first attempt fails (SPEC §8 robustness). */
export async function gotoWithRetry(page: Page, url: string): Promise<Response | null> {
  try {
    return await page.goto(url, { waitUntil: 'load' });
  } catch {
    return await page.goto(url, { waitUntil: 'load' });
  }
}
