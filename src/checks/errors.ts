import type { EvidenceEvent } from '../browser/evidence.js';
import { makeFinding, type Finding } from '../report/schema.js';
import type { CheckResult } from './types.js';

const MAX_LOG_LINES = 10;
/** Request types that carry the app's code, styles and data. */
const DATA_TYPES = new Set(['fetch', 'xhr']);
const CODE_TYPES = new Set(['script', 'stylesheet']);
/** Failures we cause ourselves or that are normal when a page navigates away. */
const HARMLESS_FAILURES = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|NS_BINDING_ABORTED/i;

function unique(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts.entries()]
    .slice(0, MAX_LOG_LINES)
    .map(([line, count]) => (count > 1 ? `${line} (×${count})` : line));
}

function ofKind<K extends EvidenceEvent['kind']>(
  events: readonly EvidenceEvent[],
  kind: K,
): Extract<EvidenceEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<EvidenceEvent, { kind: K }> => e.kind === kind);
}

const firstUrl = (events: readonly EvidenceEvent[]): string | undefined =>
  events[0]?.pageUrl || undefined;

/**
 * Runtime errors seen during the whole run (SPEC §6.2): crashes in the page's code, error
 * messages in the browser console, and requests that failed.
 * Broken images and links are left to the links check so nothing is reported twice.
 */
export function checkErrors(events: readonly EvidenceEvent[]): CheckResult {
  const findings: Finding[] = [];
  const passed: string[] = [];

  const crashes = ofKind(events, 'page-error');
  if (crashes.length > 0) {
    const url = firstUrl(crashes);
    findings.push(
      makeFinding({
        rule: 'errors/uncaught-exception',
        title: 'Part of your app’s code crashes in the background',
        severity: 'minor',
        category: 'errors',
        device: 'desktop',
        whatHappened: `While pages were loading, the app’s code hit ${crashes.length === 1 ? 'an error' : `${crashes.length} errors`} that it did not handle. Visitors don’t see a message, but whatever that code was meant to do did not happen.`,
        whyItMatters:
          'A silent crash can leave buttons, tracking or other features not working, and it is often the first sign of a bigger bug.',
        stepsToReproduce: [
          `Open ${url ?? 'the app'} in Chrome.`,
          'Open the developer tools (right-click → Inspect) and choose the Console tab.',
          'Reload the page and look for red error lines.',
        ],
        evidence: {
          screenshots: [],
          logs: unique(crashes.map((e) => `${e.text} — on ${e.pageUrl}`)),
          ...(url ? { url } : {}),
        },
        fixPrompt: `My app throws uncaught JavaScript errors while pages load. Please find the cause of each one and fix it so that no errors appear in the browser console on load. Errors:\n${unique(
          crashes.map((e) => `- ${e.text} (page: ${e.pageUrl})`),
        ).join('\n')}`,
        confidence: 'verified',
      }),
    );
  } else {
    passed.push('No crashes in the app’s code while pages loaded');
  }

  const consoleErrors = ofKind(events, 'console-error').filter(
    // The browser's own "Failed to load resource" lines duplicate the failed requests below.
    (e) => !e.text.startsWith('Failed to load resource'),
  );
  if (consoleErrors.length > 0) {
    const url = firstUrl(consoleErrors);
    findings.push(
      makeFinding({
        rule: 'errors/console-errors',
        title: 'Your app reports errors in the browser’s error log',
        severity: 'minor',
        category: 'errors',
        device: 'desktop',
        whatHappened: `The app wrote ${consoleErrors.length === 1 ? 'an error message' : `${consoleErrors.length} error messages`} to the browser’s hidden error log while it was being used.`,
        whyItMatters:
          'These messages usually point at something that is not working as intended, even when the page looks fine.',
        stepsToReproduce: [
          `Open ${url ?? 'the app'} in Chrome.`,
          'Open the developer tools (right-click → Inspect) and choose the Console tab.',
          'Use the page and watch for red error lines.',
        ],
        evidence: {
          screenshots: [],
          logs: unique(consoleErrors.map((e) => `${e.text} — on ${e.pageUrl}`)),
          ...(url ? { url } : {}),
        },
        fixPrompt: `My app logs these errors to the browser console. Please fix the underlying causes:\n${unique(
          consoleErrors.map((e) => `- ${e.text} (page: ${e.pageUrl})`),
        ).join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const badResponses = ofKind(events, 'bad-response');
  const describe = (e: Extract<EvidenceEvent, { kind: 'bad-response' }>) =>
    `${e.status} ${e.method} ${e.url} — on ${e.pageUrl}`;

  const serverErrors = badResponses.filter(
    (e) => DATA_TYPES.has(e.resourceType) && e.status >= 500,
  );
  if (serverErrors.length > 0) {
    const url = firstUrl(serverErrors);
    findings.push(
      makeFinding({
        rule: 'errors/server-error',
        title: 'Your app’s server answered with an error',
        severity: 'major',
        category: 'errors',
        device: 'desktop',
        whatHappened: `The app asked its server for data ${serverErrors.length === 1 ? 'and the server replied' : `${serverErrors.length} times and the server replied`} with an internal error.`,
        whyItMatters:
          'When the server fails, visitors see missing data, endless loading or actions that silently do nothing.',
        stepsToReproduce: [
          `Open ${url ?? 'the app'}.`,
          'Open the developer tools and choose the Network tab.',
          'Reload and look for requests marked in red with a 5xx status.',
        ],
        evidence: {
          screenshots: [],
          logs: unique(serverErrors.map(describe)),
          ...(url ? { url } : {}),
        },
        fixPrompt: `These requests from my app get a server error (HTTP 5xx). Please find out why the backend fails and fix it, and show the user a friendly message if a request fails:\n${unique(
          serverErrors.map((e) => `- ${describe(e)}`),
        ).join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const missingCode = badResponses.filter((e) => CODE_TYPES.has(e.resourceType));
  if (missingCode.length > 0) {
    const url = firstUrl(missingCode);
    findings.push(
      makeFinding({
        rule: 'errors/missing-code-file',
        title: 'A file your app needs in order to work could not be loaded',
        severity: 'major',
        category: 'errors',
        device: 'desktop',
        whatHappened: `The page asked for ${missingCode.length === 1 ? 'a code or style file' : `${missingCode.length} code or style files`} and the server could not provide ${missingCode.length === 1 ? 'it' : 'them'}.`,
        whyItMatters:
          'Without these files, parts of the page can look broken or stop responding to clicks.',
        stepsToReproduce: [
          `Open ${url ?? 'the app'}.`,
          'Open the developer tools and choose the Network tab.',
          'Reload and look for script or style files marked in red.',
        ],
        evidence: {
          screenshots: [],
          logs: unique(missingCode.map(describe)),
          ...(url ? { url } : {}),
        },
        fixPrompt: `These script/style files fail to load in my app. Please fix the paths or make sure the files are deployed:\n${unique(
          missingCode.map((e) => `- ${describe(e)}`),
        ).join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  const clientErrors = badResponses.filter(
    (e) => DATA_TYPES.has(e.resourceType) && e.status >= 400 && e.status < 500,
  );
  const dropped = ofKind(events, 'request-failed').filter(
    (e) =>
      (DATA_TYPES.has(e.resourceType) || CODE_TYPES.has(e.resourceType)) &&
      !HARMLESS_FAILURES.test(e.text),
  );
  if (clientErrors.length > 0 || dropped.length > 0) {
    const logs = unique([
      ...clientErrors.map(describe),
      ...dropped.map((e) => `no answer (${e.text}) ${e.method} ${e.url} — on ${e.pageUrl}`),
    ]);
    const url = firstUrl([...clientErrors, ...dropped]);
    findings.push(
      makeFinding({
        rule: 'errors/failed-requests',
        title: 'Some background requests made by your app failed',
        severity: 'minor',
        category: 'errors',
        device: 'desktop',
        whatHappened:
          'While the app was loading, some of its requests for data were refused or never got an answer.',
        whyItMatters:
          'Failed requests often mean a piece of the page stays empty or a feature quietly does not work.',
        stepsToReproduce: [
          `Open ${url ?? 'the app'}.`,
          'Open the developer tools and choose the Network tab.',
          'Reload and look for requests marked in red.',
        ],
        evidence: { screenshots: [], logs, ...(url ? { url } : {}) },
        fixPrompt: `These background requests fail in my app. Please check each one, fix the cause, and handle failures gracefully in the UI:\n${logs.map((l) => `- ${l}`).join('\n')}`,
        confidence: 'verified',
      }),
    );
  }

  if (serverErrors.length + missingCode.length + clientErrors.length + dropped.length === 0) {
    passed.push('No failed requests for the app’s code or data');
  }

  return { findings, passed, notTested: [] };
}
