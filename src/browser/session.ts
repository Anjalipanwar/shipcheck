import {
  chromium,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  type Route,
} from 'playwright';
import {
  BACKSTOP_REASON_TEXT,
  decideRequest,
  installBackstop,
  type BackstopReason,
} from './backstop.js';
import { withShipCheckSuffix, type DevicePreset } from './devices.js';
import {
  createDomainLock,
  decideRoute,
  isPrivateNetworkTarget,
  type DomainLock,
} from './domain.js';
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

/** A redirect hop the backstop refuses (e.g. a 307 that repeats a POST to a "delete" address). */
export type HopVeto = (hop: { url: string; method: string; postData: string | null }) => boolean;

/** Redirect hops followed by hand for one page navigation, at most. */
const MAX_REDIRECT_HOPS = 10;

/**
 * Installs the domain lock (SPEC §7.1) on a browser context.
 * A blocked navigation is answered with an empty "204 No Content" reply: the browser then
 * simply stays on the page it was on, and the outside site is never contacted.
 *
 * Server redirects (audit A-01): the browser follows a 301/302/303/307/308 answer on its own,
 * and Playwright does not show those follow-up requests to `route()`. So every page navigation
 * within the site is fetched here with redirects switched off, and each hop is checked before
 * it is requested. A navigation that would leave the site is blocked before the other site is
 * contacted.
 */
export async function installDomainLock(
  context: BrowserContext,
  lock: DomainLock,
  onBlocked: (url: string, pageUrl: string) => void,
  vetoHop?: HopVeto,
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
    if (!request.isNavigationRequest() || !isTopFrame) {
      await route.fallback();
      return;
    }
    await navigateWithCheckedRedirects(
      route,
      context,
      lock,
      (url) => onBlocked(url, pageUrl),
      vetoHop,
    );
  });
}

const isRedirect = (response: APIResponse): boolean =>
  response.status() >= 300 && response.status() < 400 && Boolean(response.headers()['location']);

/**
 * Performs one page navigation for the browser, following redirects by hand and checking every
 * hop against the domain lock (and the backstop). Within the site, the browser is then sent
 * straight to the final address; cookies set on the way are kept by the shared cookie jar.
 * The final page is requested a second time by the browser (a plain GET, like a reload).
 * Anything that goes wrong fails closed: the navigation is aborted, never let through unchecked.
 */
async function navigateWithCheckedRedirects(
  route: Route,
  context: BrowserContext,
  lock: DomainLock,
  blocked: (url: string) => void,
  vetoHop: HopVeto | undefined,
): Promise<void> {
  const request = route.request();
  const abort = () => route.abort('failed').catch(() => undefined);
  let response: APIResponse;
  try {
    response = await route.fetch({ maxRedirects: 0, timeout: NAVIGATION_TIMEOUT_MS });
  } catch {
    await abort();
    return;
  }
  let url = request.url();
  let method = request.method();
  for (let hops = 0; isRedirect(response); hops += 1) {
    if (hops >= MAX_REDIRECT_HOPS) {
      await abort();
      return;
    }
    const status = response.status();
    const next = new URL(response.headers()['location'] as string, url).toString();
    await response.dispose().catch(() => undefined);
    if (!lock.isAllowed(next)) {
      blocked(next);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    // 307/308 repeat the request as it was; the others continue with a plain GET (as browsers do).
    const repeats = status === 307 || status === 308;
    if (!repeats && method !== 'HEAD') method = 'GET';
    if (vetoHop?.({ url: next, method, postData: repeats ? request.postData() : null })) {
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    try {
      response = repeats
        ? await route.fetch({ url: next, maxRedirects: 0, timeout: NAVIGATION_TIMEOUT_MS })
        : await context.request.fetch(next, {
            method,
            maxRedirects: 0,
            timeout: NAVIGATION_TIMEOUT_MS,
          });
    } catch {
      await abort();
      return;
    }
    url = next;
  }
  if (url === request.url()) {
    await route.fulfill({ response });
    return;
  }
  await response.dispose().catch(() => undefined);
  await route.fulfill({ status: 302, headers: { location: url } });
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
        args: [
          ...(options.cdpPort
            ? [`--remote-debugging-port=${options.cdpPort}`, '--remote-debugging-address=127.0.0.1']
            : []),
          // Pages are handed to the browser by the domain lock (see installDomainLock), so
          // Chromium no longer knows they came from this computer or the local network and would
          // refuse the app's requests to its other local servers (e.g. an API on another port).
          // Only for apps on a local or private address; public apps keep Chromium's protection.
          ...(isPrivateNetworkTarget(options.targetUrl)
            ? ['--disable-features=LocalNetworkAccessChecks']
            : []),
        ],
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
    await installDomainLock(
      context,
      this.lock,
      (url, pageUrl) => this.evidence.recordBlockedNavigation(device.name, pageUrl, url),
      // A redirect hop gets the same backstop check as a request the browser sends itself.
      (hop) => {
        const reason: BackstopReason | null = decideRequest({ ...hop, resourceType: 'document' });
        if (!reason) return false;
        this.evidence.recordBlockedRequest(device.name, hop.url, {
          url: hop.url,
          method: hop.method,
          reason: BACKSTOP_REASON_TEXT[reason],
          cause: reason,
          topLevel: true,
        });
        return true;
      },
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
