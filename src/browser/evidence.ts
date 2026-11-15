import { bodyKeys } from './body-keys.js';
import type { BrowserContext, Page, Request } from 'playwright';
import type { ActionLogEntry } from '../report/schema.js';
import type { BackstopReason } from './backstop.js';
import type { DeviceName } from './devices.js';

export type EvidenceEvent = {
  at: string;
  device: DeviceName;
  /** Address of the page the event happened on. */
  pageUrl: string;
  /** Which flow/step was running, when known. */
  scope?: string;
} & (
  | { kind: 'console-error'; text: string }
  | { kind: 'page-error'; text: string }
  | {
      kind: 'request-failed';
      url: string;
      method: string;
      resourceType: string;
      text: string;
      /** Set when ShipCheck itself stopped the request (it is then never an app bug). */
      blockedBy?: 'shipcheck';
    }
  | { kind: 'bad-response'; url: string; method: string; resourceType: string; status: number }
  | { kind: 'insecure-request'; url: string; resourceType: string }
  | { kind: 'blocked-navigation'; url: string }
  | {
      kind: 'blocked-request';
      url: string;
      method: string;
      /** Plain-English reason, used in messages. */
      reason: string;
      cause: BackstopReason;
      /** The request would have opened a new page in the main window (not a background call). */
      topLevel: boolean;
    }
  | {
      kind: 'write-response';
      url: string;
      method: string;
      status: number;
      /** Field names in the request body — never the values. */
      bodyKeys: string[];
    }
  | { kind: 'dialog'; text: string; dialogType: string }
);

export interface Screenshot {
  /** Path relative to the report folder. */
  file: string;
  label: string;
  device: DeviceName;
  url: string;
  data: Buffer;
}

const MAX_EVENTS = 2000;
const MAX_TEXT = 500;
const MAX_SCREENSHOTS = 60;
/** JPEG quality: small enough to embed dozens in one report, sharp enough to read text. */
const SCREENSHOT_QUALITY = 55;
const HIDDEN = '[hidden]';

const clip = (text: string): string =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… (shortened)` : text;

const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'shot';

/**
 * Collects everything a finding can later point to: errors, failed requests, screenshots and
 * the log of actions taken. Secrets registered with `protect()` are scrubbed from all of it.
 */
export class Evidence {
  readonly events: EvidenceEvent[] = [];
  readonly screenshots: Screenshot[] = [];
  readonly actionLog: ActionLogEntry[] = [];
  private readonly secrets = new Set<string>();
  /** Requests ShipCheck stopped on purpose, so their failure is tagged as ours. */
  private readonly blocked = new WeakSet<Request>();
  private scope: string | undefined;

  /** Registers a value (password, API key) that must never appear in logs or reports. */
  protect(secret: string | undefined): void {
    if (secret && secret.length >= 4) this.secrets.add(secret);
  }

  /** Replaces every protected value in the text. */
  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) result = result.split(secret).join(HIDDEN);
    return result;
  }

  setScope(scope: string | undefined): void {
    this.scope = scope;
  }

  private push(device: DeviceName, pageUrl: string, event: Record<string, unknown>): void {
    if (this.events.length >= MAX_EVENTS) return;
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      cleaned[key] = typeof value === 'string' ? clip(this.redact(value)) : value;
    }
    this.events.push({
      at: new Date().toISOString(),
      device,
      pageUrl: this.redact(pageUrl),
      ...(this.scope ? { scope: this.scope } : {}),
      ...cleaned,
    } as EvidenceEvent);
  }

  recordBlockedNavigation(device: DeviceName, pageUrl: string, url: string): void {
    this.push(device, pageUrl, { kind: 'blocked-navigation', url });
  }

  /** A request the safety backstop refused to send (payment, card number, delete…). */
  recordBlockedRequest(
    device: DeviceName,
    pageUrl: string,
    request: {
      url: string;
      method: string;
      reason: string;
      cause: BackstopReason;
      topLevel: boolean;
    },
    browserRequest?: Request,
  ): void {
    if (browserRequest) this.blocked.add(browserRequest);
    this.push(device, pageUrl, { kind: 'blocked-request', ...request });
  }

  /** How many events of one kind were recorded so far (to see what an action caused). */
  count(kind: EvidenceEvent['kind']): number {
    return this.events.filter((event) => event.kind === kind).length;
  }

  /** Starts listening on every page of this browser context, including pages opened later. */
  attach(context: BrowserContext, device: DeviceName): void {
    const watch = (page: Page) => {
      const pageUrl = () => {
        try {
          return page.url();
        } catch {
          return '';
        }
      };
      page.on('console', (message) => {
        if (message.type() === 'error') {
          this.push(device, pageUrl(), { kind: 'console-error', text: message.text() });
        }
      });
      page.on('pageerror', (error) => {
        this.push(device, pageUrl(), { kind: 'page-error', text: error.message });
      });
      page.on('requestfailed', (request) => {
        this.push(device, pageUrl(), {
          kind: 'request-failed',
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          text: request.failure()?.errorText ?? 'failed',
          ...(this.blocked.has(request) ? { blockedBy: 'shipcheck' } : {}),
        });
      });
      page.on('request', (request) => {
        const current = pageUrl();
        if (current.startsWith('https://') && request.url().startsWith('http://')) {
          this.push(device, current, {
            kind: 'insecure-request',
            url: request.url(),
            resourceType: request.resourceType(),
          });
        }
      });
      page.on('response', (response) => {
        const request = response.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          // Answers to data-changing requests show whether a form was really accepted.
          this.push(device, pageUrl(), {
            kind: 'write-response',
            url: response.url(),
            method: request.method(),
            status: response.status(),
            bodyKeys: bodyKeys(request.postData()),
          });
        }
        if (response.status() < 400) return;
        this.push(device, pageUrl(), {
          kind: 'bad-response',
          url: response.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          status: response.status(),
        });
      });
      page.on('dialog', (dialog) => {
        this.push(device, pageUrl(), {
          kind: 'dialog',
          text: dialog.message(),
          dialogType: dialog.type(),
        });
        // Never accept: an "Are you sure?" box might be guarding something destructive.
        dialog.dismiss().catch(() => undefined);
      });
    };
    context.pages().forEach(watch);
    context.on('page', watch);
  }

  /** Takes a compressed screenshot of what is visible. Returns undefined if it fails. */
  async screenshot(page: Page, device: DeviceName, label: string): Promise<Screenshot | undefined> {
    if (this.screenshots.length >= MAX_SCREENSHOTS) return undefined;
    try {
      const data = await page.screenshot({
        type: 'jpeg',
        quality: SCREENSHOT_QUALITY,
        scale: 'css',
        timeout: 10_000,
      });
      const number = String(this.screenshots.length + 1).padStart(2, '0');
      const shot: Screenshot = {
        file: `screenshots/${number}-${device}-${slug(label)}.jpg`,
        label,
        device,
        url: this.redact(page.url()),
        data,
      };
      this.screenshots.push(shot);
      return shot;
    } catch {
      return undefined;
    }
  }

  /** Adds one entry to the action log (kept precise for the planned Playwright export). */
  logAction(entry: Omit<ActionLogEntry, 'step' | 'at' | 'flow'> & { flow?: string }): void {
    const flow = entry.flow ?? this.scope;
    this.actionLog.push({
      ...entry,
      step: this.actionLog.length + 1,
      at: new Date().toISOString(),
      ...(flow ? { flow } : {}),
      intent: this.redact(entry.intent),
      url: this.redact(entry.url),
      ...(entry.value !== undefined ? { value: this.redact(entry.value) } : {}),
      ...(entry.detail !== undefined ? { detail: clip(this.redact(entry.detail)) } : {}),
    });
  }
}
