import { createHash } from 'node:crypto';
import type { Screenshot } from '../browser/evidence.js';
import { REPO_URL } from '../version.js';
import { REPORT_CSS, REPORT_JS } from './assets.js';
import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  CONFIDENCE_LEGEND,
  DEVICE_LABEL,
  DISCLAIMER,
  NOT_CHECKED,
  SEVERITIES,
  SEVERITY_LABEL,
  SEVERITY_MEANING,
  VERDICT_LABEL,
  formatDate,
  formatDuration,
  groupFindings,
  modelLine,
  nothingUrgentText,
  verdictSummary,
  severityCount,
  SEVERITY_LEGEND,
  verdictTone,
} from './present.js';
import { coverageView, type CoverageRow } from './coverage-view.js';
import type { Finding, Report } from './schema.js';
import { topIssues } from './verdict.js';

export type ReportImage = Pick<Screenshot, 'file' | 'label' | 'device' | 'data'>;

export interface HtmlOptions {
  /** Budget for embedded screenshots, in bytes of base64 text. */
  maxImageBytes?: number;
}

/** SPEC §5.3 target: the whole file stays under 5 MB. Text is small; pictures get the rest. */
export const MAX_REPORT_BYTES = 5_000_000;
export const DEFAULT_IMAGE_BUDGET = 4_300_000;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Everything that comes from the tested app passes through here before it reaches the page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only ordinary web addresses become clickable links — never javascript: or data: addresses. */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

const e = escapeHtml;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('base64');

function link(url: string): string {
  const href = safeHref(url);
  return href ? `<a href="${e(href)}" rel="noopener noreferrer">${e(url)}</a>` : e(url);
}

/**
 * Embeds each screenshot once. A second mention links back to the first, and screenshots that
 * no longer fit the size budget are referenced as files in the "screenshots" folder instead.
 */
class Gallery {
  private readonly shown = new Map<string, string>();
  private used = 0;
  private readonly byFile: Map<string, ReportImage>;

  constructor(
    images: readonly ReportImage[],
    private readonly budget: number,
  ) {
    this.byFile = new Map(images.map((image) => [image.file, image]));
  }

  render(file: string): string {
    const image = this.byFile.get(file);
    const mime = MIME[file.split('.').pop()?.toLowerCase() ?? ''];
    if (!image || !mime) {
      return `<p class="where">Screenshot file: ${e(file)} (in the report folder)</p>`;
    }
    const caption = `${image.label} (${image.device === 'mobile' ? 'phone' : 'desktop'})`;
    const earlier = this.shown.get(file);
    if (earlier) {
      return `<p class="where"><a href="#${earlier}" data-shot="${earlier}">Same screenshot as above: ${e(caption)}</a></p>`;
    }
    const base64 = image.data.toString('base64');
    if (this.used + base64.length > this.budget) {
      return `<p class="where">Screenshot “${e(caption)}” is saved next to this report: <a href="${e(encodeURI(file))}">${e(file)}</a></p>`;
    }
    this.used += base64.length;
    const id = `shot-${this.shown.size + 1}`;
    this.shown.set(file, id);
    return [
      '<figure>',
      `<button type="button" class="shot" data-shot="${id}" aria-label="Enlarge screenshot: ${e(caption)}">`,
      `<img id="${id}" src="data:${mime};base64,${base64}" alt="Screenshot: ${e(caption)}">`,
      '</button>',
      `<figcaption>${e(caption)}<span class="zoom"> — click to enlarge</span></figcaption>`,
      '</figure>',
    ].join('');
  }
}

function header(report: Report): string {
  const { meta } = report;
  const rows: [string, string][] = [
    ['App', link(meta.url)],
    ['Date', e(formatDate(meta.startedAt))],
    ['Duration', e(formatDuration(meta.durationMs))],
    ['AI model', e(modelLine(meta))],
    ['ShipCheck version', e(meta.shipcheckVersion)],
  ];
  return [
    '<header class="top"><div class="wrap">',
    '<p class="brand">ShipCheck</p>',
    '<h1>Pre-launch report</h1>',
    '<dl class="meta">',
    ...rows.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`),
    '</dl>',
    '</div></header>',
  ].join('\n');
}

function verdictBanner(report: Report): string {
  const counts = SEVERITIES.map(
    (severity) =>
      `<li><span class="badge sev-${severity}" title="${e(SEVERITY_LABEL[severity])}: ${e(SEVERITY_MEANING[severity])}">${e(severityCount(severity, report.counts[severity]))}</span></li>`,
  );
  return [
    `<section class="verdict v-${report.verdict} t-${verdictTone(report)}" aria-labelledby="verdict-title">`,
    '<h2 id="verdict-title">Verdict</h2>',
    `<p class="big">${e(VERDICT_LABEL[report.verdict])}</p>`,
    `<p>${e(verdictSummary(report))}</p>`,
    `<ul class="counts" aria-label="Issues by severity">${counts.join('')}</ul>`,
    `<p class="legend">${e(SEVERITY_LEGEND)}</p>`,
    '</section>',
  ].join('\n');
}

/**
 * "What this report covers" (owner decisions 2026-11-15): always shown, right under the verdict,
 * never collapsed. Each row is in one of four states; the words are visible text, never only a
 * colour or a hover. A row with problems links to the first (worst) of them.
 */
export function coverageBox(report: Report, anchors: Map<Finding, string> = new Map()): string {
  const view = coverageView(report);
  const row = (item: CoverageRow): string => {
    const anchor = item.findings.map((finding) => anchors.get(finding)).find(Boolean);
    const text = anchor ? `<a href="#${anchor}">${e(item.text)}</a>` : e(item.text);
    const tone = item.state === 'problems' ? ` s-${item.worst ?? 'minor'}` : '';
    return [
      `<tr class="st-${item.state}${tone}">`,
      `<th scope="row">${e(item.label)}</th>`,
      `<td><span class="icon" aria-hidden="true">${item.icon}</span> <span class="state">${text}</span>`,
      item.partial ? `<span class="why">${e(item.partial)}</span>` : '',
      '</td></tr>',
    ].join('');
  };
  const groups = view.groups.map((group) =>
    [
      `<tbody><tr class="group"><th colspan="2" scope="colgroup">${e(group.heading)}</th></tr>`,
      ...group.rows.map(row),
      '</tbody>',
    ].join(''),
  );
  const next = view.command
    ? [
        `<p><strong>${e(view.nextLabel)}</strong> ${e(view.next)}</p>`,
        `<pre class="cmd"><code>${e(view.command)}</code></pre>`,
        `<p><a href="${e(view.help.url)}" rel="noopener noreferrer">${e(view.help.text)}</a></p>`,
      ]
    : [`<p><strong>${e(view.nextLabel)}</strong> ${e(view.next)}</p>`];
  return [
    '<section class="coverage" aria-labelledby="coverage-title">',
    `<h2 id="coverage-title">${e(view.title)}</h2>`,
    `<p class="check-type">${e(view.checkType)}</p>`,
    `<p>${e(view.did)}</p>`,
    '<table class="cov">',
    `<caption class="sr-only">${e(view.tableCaption)}</caption>`,
    '<thead class="sr-only"><tr><th scope="col">Area</th><th scope="col">Result</th></tr></thead>',
    ...groups,
    '</table>',
    ...(view.other ? [`<p class="other">⚠ ${e(view.other)}</p>`] : []),
    ...(view.whyDiffer ? [`<p class="why-differ">${e(view.whyDiffer)}</p>`] : []),
    ...next,
    '</section>',
  ].join('\n');
}

function firstLook(gallery: Gallery, images: readonly ReportImage[]): string {
  const first = images[0];
  if (!first) return '';
  return [
    '<section aria-labelledby="look-title">',
    '<h2 id="look-title">Your app as ShipCheck saw it</h2>',
    `<div class="panel"><div class="shots">${gallery.render(first.file)}</div></div>`,
    '</section>',
  ].join('\n');
}

function fixFirst(report: Report, anchors: Map<Finding, string>): string {
  const top = topIssues(report.findings);
  const body =
    top.length === 0
      ? `<p>${e(nothingUrgentText(report))}</p>`
      : `<ol class="first">${top
          .map(
            (finding) =>
              `<li><span class="badge sev-${finding.severity}">${e(SEVERITY_LABEL[finding.severity])}</span><a href="#${anchors.get(finding)}">${e(finding.title)}</a></li>`,
          )
          .join('')}</ol>`;
  return [
    '<section aria-labelledby="first-title">',
    '<h2 id="first-title">Fix these first</h2>',
    `<div class="panel">${body}</div>`,
    '</section>',
  ].join('\n');
}

function card(finding: Finding, id: string, gallery: Gallery): string {
  const { evidence } = finding;
  const logs = evidence.logs ?? [];
  const parts = [
    `<article class="card c-${finding.severity}" id="${id}" aria-labelledby="${id}-title">`,
    `<h4 id="${id}-title">${e(finding.title)}</h4>`,
    '<ul class="badges">',
    `<li><span class="badge sev-${finding.severity}">${e(SEVERITY_LABEL[finding.severity])}</span></li>`,
    `<li><span class="tag">${e(CATEGORY_LABEL[finding.category])}</span></li>`,
    `<li><span class="tag">${e(DEVICE_LABEL[finding.device])}</span></li>`,
    `<li><span class="tag">${e(CONFIDENCE_LABEL[finding.confidence])}</span></li>`,
    '</ul>',
    `<h5>What happened</h5><p>${e(finding.whatHappened)}</p>`,
    `<h5>Why it matters</h5><p>${e(finding.whyItMatters)}</p>`,
  ];
  if (finding.stepsToReproduce.length > 0) {
    parts.push(
      '<h5>Steps to reproduce</h5>',
      `<ol class="steps">${finding.stepsToReproduce.map((step) => `<li>${e(step)}</li>`).join('')}</ol>`,
    );
  }
  parts.push('<h5>Evidence</h5>');
  if (evidence.screenshots.length > 0) {
    parts.push(
      `<div class="shots">${evidence.screenshots.map((file) => gallery.render(file)).join('')}</div>`,
    );
  }
  if (evidence.url) parts.push(`<p class="where">Where: ${link(evidence.url)}</p>`);
  if (logs.length > 0) {
    parts.push(
      `<details><summary>Technical details (${logs.length} ${logs.length === 1 ? 'line' : 'lines'})</summary><pre>${e(logs.join('\n'))}</pre></details>`,
    );
  }
  if (finding.fixPrompt?.trim()) {
    parts.push(
      '<div class="fix">',
      `<div class="fix-head"><h5>Fix prompt</h5><button type="button" class="copy" data-copy="${id}-prompt" aria-label="Copy fix prompt: ${e(finding.title)}">Copy</button></div>`,
      '<p class="hint">Paste this into Lovable, Bolt, Cursor or Claude Code.</p>',
      `<pre id="${id}-prompt">${e(finding.fixPrompt.trim())}</pre>`,
      '</div>',
    );
  }
  parts.push('</article>');
  return parts.join('\n');
}

function allIssues(
  findings: readonly Finding[],
  anchors: Map<Finding, string>,
  gallery: Gallery,
): string {
  const groups = groupFindings(findings);
  const body =
    groups.length === 0
      ? '<div class="panel"><p>No issues found.</p></div>'
      : groups
          .map((group) =>
            [
              `<h3>${e(group.label)}</h3>`,
              ...group.findings.map((finding) =>
                card(finding, anchors.get(finding) ?? '', gallery),
              ),
            ].join('\n'),
          )
          .join('\n');
  return [
    '<section aria-labelledby="issues-title">',
    `<h2 id="issues-title">All issues (${findings.length})</h2>`,
    findings.length > 0 ? `<p class="legend">${e(CONFIDENCE_LEGEND)}</p>` : '',
    body,
    '</section>',
  ].join('\n');
}

function listSection(
  id: string,
  title: string,
  kind: string,
  lines: readonly string[],
  empty: string,
): string {
  const body =
    lines.length === 0
      ? `<p>${e(empty)}</p>`
      : `<ul class="list ${kind}">${lines.map((line) => `<li>${e(line)}</li>`).join('')}</ul>`;
  return [
    `<section aria-labelledby="${id}">`,
    `<h2 id="${id}">${e(title)}</h2>`,
    `<div class="panel">${body}</div>`,
    '</section>',
  ].join('\n');
}

/** The visible page: everything between <body> and the script. Exported for the structure test. */
export function renderBody(
  report: Report,
  images: readonly ReportImage[] = [],
  options: HtmlOptions = {},
): string {
  const gallery = new Gallery(images, options.maxImageBytes ?? DEFAULT_IMAGE_BUDGET);
  const anchors = new Map(
    report.findings.map((finding, index) => [finding, `issue-${index + 1}`] as const),
  );
  // Issue cards are rendered before the first-look picture is placed, so that the size budget
  // goes to evidence first; the page order is unaffected.
  const issues = allIssues(report.findings, anchors, gallery);
  const look = firstLook(gallery, images);
  return [
    '<a class="skip" href="#main">Skip to the report</a>',
    header(report),
    '<main id="main" class="wrap">',
    verdictBanner(report),
    coverageBox(report, anchors),
    fixFirst(report, anchors),
    look,
    issues,
    listSection(
      'worked-title',
      'What worked',
      'worked',
      report.passed,
      'No checks passed in this run.',
    ),
    listSection(
      'skipped-title',
      'What we couldn’t test',
      'skipped',
      report.notTested,
      'Nothing — every planned check ran.',
    ),
    '</main>',
    '<footer><div class="wrap">',
    `<p>${e(DISCLAIMER)}</p>`,
    `<p>${e(NOT_CHECKED)}</p>`,
    `<p>Made with <a href="${e(REPO_URL)}" rel="noopener noreferrer">ShipCheck</a> ${e(report.meta.shipcheckVersion)} — free and open source.</p>`,
    '</div></footer>',
    '<dialog id="lightbox" aria-labelledby="lightbox-title">',
    '<div class="bar"><strong id="lightbox-title" class="caption">Screenshot</strong><button type="button" data-close>Close</button></div>',
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="">',
    '</dialog>',
    '<div id="status" class="sr-only" role="status" aria-live="polite"></div>',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * Renders the whole report as one self-contained HTML file (SPEC §5.3).
 * The page's security policy allows only its own inline style and script (by hash) and embedded
 * pictures, so opening a report can never load or send anything over the network.
 */
export function renderHtml(
  report: Report,
  images: readonly ReportImage[] = [],
  options: HtmlOptions = {},
): string {
  let host = report.meta.url;
  try {
    host = new URL(report.meta.url).host;
  } catch {
    // Keep the raw text; it is escaped below.
  }
  const policy = [
    "default-src 'none'",
    'img-src data:',
    `style-src 'sha256-${sha256(REPORT_CSS)}'`,
    `script-src 'sha256-${sha256(REPORT_JS)}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    `<meta name="generator" content="ShipCheck ${e(report.meta.shipcheckVersion)}">`,
    `<title>ShipCheck report — ${e(VERDICT_LABEL[report.verdict])} — ${e(host)}</title>`,
    '<link rel="icon" href="data:,">',
    `<style>${REPORT_CSS}</style>`,
    '</head>',
    '<body>',
    renderBody(report, images, options),
    `<script>${REPORT_JS}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
