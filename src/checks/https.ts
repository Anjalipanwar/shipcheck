import { isLocalAddress } from '../browser/domain.js';
import { makeFinding } from '../report/schema.js';
import type { CheckResult } from './types.js';

export interface HttpsFacts {
  /** The address the user asked us to test. */
  targetUrl: string;
  /** Where the browser ended up after redirects. */
  finalUrl: string;
  /** Requests made over plain http:// from a secure https:// page. */
  insecureRequests: string[];
}

export function checkHttps(facts: HttpsFacts): CheckResult {
  const final = new URL(facts.finalUrl);

  if (isLocalAddress(final.hostname)) {
    return {
      findings: [
        makeFinding({
          rule: 'https/local-address',
          title: 'Local address — HTTPS not checked',
          severity: 'info',
          category: 'security',
          device: 'both',
          whatHappened:
            'This app was tested on an address that only exists on this computer, so the secure-connection check was skipped.',
          whyItMatters:
            'Secure connections (HTTPS) only matter once the app is online. Run ShipCheck again on the public address before you launch.',
          stepsToReproduce: [],
          evidence: {
            screenshots: [],
            logs: [`Address tested: ${final.origin}`],
            url: facts.finalUrl,
          },
          confidence: 'verified',
        }),
      ],
      passed: [],
      notTested: ['Secure connection (HTTPS) — the app was tested on a local address'],
    };
  }

  if (final.protocol !== 'https:') {
    return {
      findings: [
        makeFinding({
          rule: 'https/missing',
          title: 'Your app does not use a secure connection (HTTPS)',
          severity: 'major',
          category: 'security',
          device: 'both',
          whatHappened: `The app opens at ${final.origin}, which starts with “http://” rather than “https://”.`,
          whyItMatters:
            'Browsers label such sites “Not secure”, and passwords or personal details typed into the app can be read by others on the same network.',
          stepsToReproduce: [
            `Open ${facts.finalUrl}.`,
            'Look at the address bar: the browser shows “Not secure”.',
          ],
          evidence: {
            screenshots: [],
            logs: [
              `Address requested: ${facts.targetUrl}`,
              `Address the browser ended on: ${facts.finalUrl}`,
            ],
            url: facts.finalUrl,
          },
          fixPrompt:
            'My app is served over plain HTTP. Please enable HTTPS on the hosting platform (most offer a free certificate) and redirect all http:// requests to https://.',
          confidence: 'verified',
        }),
      ],
      passed: [],
      notTested: [],
    };
  }

  const insecure = [...new Set(facts.insecureRequests)];
  if (insecure.length > 0) {
    return {
      findings: [
        makeFinding({
          rule: 'https/mixed-content',
          title: 'Some parts of your secure page are loaded over an insecure connection',
          severity: 'minor',
          category: 'security',
          device: 'both',
          whatHappened: `The page itself is secure, but it loads ${insecure.length === 1 ? 'one item' : `${insecure.length} items`} over plain “http://”.`,
          whyItMatters:
            'Browsers may block these items or show a warning, so images or features can go missing for visitors.',
          stepsToReproduce: [
            `Open ${facts.finalUrl}.`,
            'Open the developer tools → Console and look for “Mixed Content” warnings.',
          ],
          evidence: { screenshots: [], logs: insecure.slice(0, 10), url: facts.finalUrl },
          fixPrompt: `My HTTPS page loads these resources over http://. Please change them to https:// (or host them locally):\n${insecure
            .slice(0, 10)
            .map((u) => `- ${u}`)
            .join('\n')}`,
          confidence: 'verified',
        }),
      ],
      passed: ['The app uses a secure connection (HTTPS)'],
      notTested: [],
    };
  }

  return { findings: [], passed: ['The app uses a secure connection (HTTPS)'], notTested: [] };
}
