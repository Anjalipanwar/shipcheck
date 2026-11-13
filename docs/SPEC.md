# ShipCheck — Product & Technical Spec (v0.1)

> Status: approved direction, written 2026-11-13. This is the source of truth for what to build.
> If something here conflicts with your instinct, follow this doc and flag the conflict to the owner.

## 1. What ShipCheck is

ShipCheck is an **open-source, pre-launch QA check for vibe-coded web apps** (apps built with Lovable, Bolt, v0, Replit, Cursor, Claude Code, etc.).

You give it a URL. An AI agent opens a real browser and **uses the app like a real first-time user**: it lands on the page, signs up, logs in, tries the main feature, fills forms with bad inputs, and repeats key steps on a phone-sized screen. In parallel, deterministic checks look for hidden errors, light security issues and SEO basics.

The output is a **single, self-contained HTML report** written in plain English for non-technical builders: a verdict, issues ranked by real-user impact, screenshots as evidence, steps to reproduce, and a ready-to-paste **fix prompt** for their AI builder.

One-liner: *"A QA engineer's pre-launch checkup for your vibe-coded app — in one command."*

## 2. Why it exists

- Millions of non-programmers now ship apps with AI tools. They can't read the code and don't know what to test, so apps launch with broken signups, dead buttons and mobile bugs.
- Professional QA tools (QA Wolf, Bug0, Momentic, mabl) are priced and designed for engineering teams with CI pipelines.
- A few tools target vibe coders (Scout QA, Blinkof.ai, scanners). ShipCheck's angle: **open source, free to run with your own AI key, and built with the judgement of a 10-year QA automation engineer** — reports that read like a good bug report, not a scanner dump.

## 3. Goals, non-goals, anti-goals

### Goals (v0.1)
1. `npx @anjalipanwar/shipcheck <url>` produces a useful report on a real vibe-coded app in ≤ 10 minutes.
2. Runs at **€0 cost to the maintainer**: users bring their own AI key (Gemini free tier works).
3. Also runs as a **GitHub Action** (reusable action in this repo).
4. Production-quality open-source project: tests, CI, clear README, MIT license, published to npm.
5. Every finding has **evidence** (screenshot and/or log) so users can verify it themselves.

### Non-goals (v0.1) — explicitly NOT building now
- Hosted web service, accounts, login, payments, database.
- Active vulnerability scanning (injection payloads, auth bypass, probing databases).
- Playwright test export (v0.2 — but log actions so it's possible later, see §9).
- Claude Code `/shipcheck` command / MCP server (v0.2).
- Visual regression, load testing, native mobile apps.

### Anti-goals — the project fails if it does these, even if it "works"
- **Causes real-world side effects**: real payments, emails/invites to real people, deleting data, posting public content.
- **Reports false alarms without evidence**, or buries real blockers in noise.
- **Wanders off the target site** or runs unbounded (cost/time blowups on the user's AI key).
- Reads like a technical log. The audience is non-technical.

## 4. Users

- **Primary:** non-technical founder/maker who built a web app with an AI builder and is about to launch. Can follow a 3-step README; can paste an API key; may have a GitHub repo (Lovable/Bolt sync to GitHub).
- **Secondary:** developers using Cursor/Claude Code who want a quick smoke check, and agencies/freelancers handing apps to clients.

## 5. User experience

### 5.1 CLI
```
npx @anjalipanwar/shipcheck https://myapp.lovable.app
```
Options:
| Flag | Meaning | Default |
|---|---|---|
| `--email`, `--password` | Test account credentials for login flow | none (agent attempts signup) |
| `--goal "<text>"` | Plain-English main task, e.g. "book a 30-minute slot" | agent infers from the page |
| `--out <dir>` | Output directory | `./shipcheck-report` |
| `--model <id>` | AI model id | auto by available key (Gemini Flash first) |
| `--skip-mobile` | Skip mobile pass | false |
| `--flows <list>` | Subset: `landing,signup,login,core,forms` | all |
| `--max-minutes <n>` | Hard time budget | 10 |
| `--fail-on <level>` | Exit non-zero at `blocker` / `major` / `none` | `blocker` |
| `--headed` | Show the browser (debugging) | false |
| `--yes` | Skip the "do you own this app?" confirmation | false |

- Credentials can also come from env vars `SHIPCHECK_EMAIL` / `SHIPCHECK_PASSWORD` (preferred in CI). Never print or store passwords in reports.
- Optional `shipcheck.config.json` in cwd mirrors the flags.
- On first run without any AI key: print a friendly 3-step message on how to get a free Gemini API key and set it. No stack traces for user errors.
- Before running, ask once: "Only test apps you own or have permission to test. Continue? (y/N)" — skipped with `--yes` or in CI (`CI=true`).
- Live terminal progress: one line per step ("Signing up… ✓", "Mobile layout… 2 issues").
- When done: print verdict, top 3 issues, and the path to `report.html`; auto-open the report locally (not in CI).

**Exit codes:** `0` = passed the `--fail-on` threshold, `1` = issues at/above threshold, `2` = ShipCheck itself failed (bad URL, no key, crash).

### 5.2 GitHub Action
```yaml
- uses: Anjalipanwar/shipcheck@v0
  with:
    url: https://myapp.lovable.app
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
    email: ${{ secrets.SHIPCHECK_EMAIL }}       # optional
    password: ${{ secrets.SHIPCHECK_PASSWORD }} # optional
```
- Uploads `shipcheck-report/` as a workflow artifact.
- Writes a Markdown summary (verdict + issue table) to `$GITHUB_STEP_SUMMARY`.
- Provide `examples/github-workflow.yml` users can copy (manual `workflow_dispatch` + optional on push).

### 5.3 The report (`report.html` + `report.json` + `report.md`)
Single self-contained HTML file (inline CSS/JS, screenshots embedded as compressed JPEG/WebP data URIs, target < 5 MB). Works offline, can be emailed or hosted on GitHub Pages.

Sections, in order:
1. **Header:** app URL, date, duration, model used, ShipCheck version.
2. **Verdict banner:** `Ready to launch` / `Fix before launch` / `Not ready`, with counts per severity.
3. **Fix these first:** top 3 issues by impact.
4. **All issues**, grouped by flow (Landing, Signup, Login, Main feature, Forms, Mobile, Security, SEO, Errors). Each issue card:
   - Title in plain English ("Signup button does nothing on iPhone")
   - Severity badge + category + device (desktop/mobile)
   - What happened / Why it matters (1–2 sentences each, no jargon)
   - Steps to reproduce (numbered)
   - Evidence: screenshot (click to enlarge), relevant console/network lines (collapsed)
   - **Fix prompt** with a copy button, written for Lovable/Bolt/Cursor/Claude Code
   - Confidence: `Verified` (deterministic) or `AI judgement` (agent-observed)
5. **What worked** — passed checks (builds trust; shows coverage).
6. **What we couldn't test** — e.g. "Signup stopped at email verification", "CAPTCHA blocked the agent", "Payment page reached; stopped before paying (by design)".
7. Footer: limits disclaimer ("Not a security audit or guarantee"), link to repo.

Visual design: clean, calm, readable on mobile; clear severity colours with text labels (never colour alone). Light theme default, respects `prefers-color-scheme`.

**Verdict rules (deterministic):** any Blocker → `Not ready`; else any Major → `Fix before launch`; else `Ready to launch`.

**Severity definitions:**
- **Blocker:** a new user cannot complete a core journey (can't sign up, log in, use main feature, page crashes, secret key exposed).
- **Major:** journey completes but is broken/confusing for many users (form accepts invalid data, mobile layout hides a button, unhandled error shown to user, missing HTTPS).
- **Minor:** polish/edge cases (slow page, missing SEO tags, missing security headers, small layout overflow).
- **Info:** observations, not bugs.

## 6. What ShipCheck checks

### 6.1 AI-driven user flows (agent uses the app)
| # | Flow | What the agent does | Typical findings |
|---|---|---|---|
| 1 | **Landing / first impression** | Load home, identify primary CTA, click main nav links and CTA | Page doesn't load, CTA dead, broken nav, console errors on load |
| 2 | **Signup / onboarding** | Find signup, create account with a generated test identity (`shipcheck+<random>@example.com` unless `--email` given), go through onboarding | Signup fails, unclear errors, stuck states. Email verification / CAPTCHA → stop and report "blocked at" (Info, not a bug) |
| 3 | **Login** | Log in with provided or just-created credentials; also try a wrong password once | Login broken, wrong-password error missing/unclear, session lost on refresh |
| 4 | **Main feature** | Use `--goal` if given, else infer the app's main action from the UI and try it end to end | Core action fails, data not saved, error after submit |
| 5 | **Forms & bad inputs** | On up to 3 forms found: submit empty, invalid email, 5,000-char text, emoji/unicode, leading/trailing spaces, double-click submit | Accepts invalid data, crashes, duplicate submissions, no validation messages |
| 6 | **Mobile pass** | Re-run Landing + Login/Main feature (budget permitting) at iPhone viewport (390×844, touch, mobile UA) | Horizontal overflow, hidden/overlapping buttons, menu won't open, tap targets too small |

### 6.2 Deterministic checks (no AI, always run, cheap)
- **Runtime errors:** console errors and uncaught exceptions during the whole run; failed requests (4xx/5xx, network failures) on the target origin and its APIs.
- **Performance basics:** load time and LCP-ish timing of landing page (Minor if slow; thresholds documented in code).
- **HTTPS & mixed content.**
- **Security headers:** CSP, HSTS, X-Content-Type-Options, frame protection (X-Frame-Options or CSP frame-ancestors), Referrer-Policy. Missing → Minor, with explanation.
- **Exposed secrets in served JS/HTML:** regex scan of page HTML and same-origin JS bundles for *secret* keys: Stripe `sk_live_`/`rk_live_`, OpenAI `sk-…`/`sk-proj-…`, Anthropic `sk-ant-…`, AWS access keys, Supabase **service_role** JWT (decode JWT payload, check `role`), GitHub tokens, private keys. **Do not flag public-by-design keys** (Stripe `pk_`, Supabase `anon` key, Firebase web config, Google Maps browser keys) — but add an Info note when a Supabase anon key is present: "make sure Row Level Security is enabled". Mask secrets in the report (show first 6 + last 4 chars). Exposed secret = Blocker.
- **SEO basics:** `<title>`, meta description, Open Graph tags (title/description/image), one `<h1>`, `lang` attribute, favicon, robots.txt, sitemap.xml, and **empty-shell check**: fetch raw HTML without JS; if visible text is near-empty, explain that search engines/AI crawlers may see a blank page (Minor).
- **Broken links & images:** same-origin links/images on visited pages (HEAD/GET, cap 50).
- **Accessibility basics:** `@axe-core/playwright` on landing (and one more visited page); report only serious/critical violations, grouped, as Minor.

### 6.3 Explicitly NOT checked (state this in README and report footer)
Active security testing, payment completion, emails sent by the app, business-logic correctness beyond what's visible, load/performance under traffic, native apps.

## 7. Safety rules (hard requirements — implement in code, not just prompts)

1. **Domain lock:** the browser may only navigate within the target site's registrable domain (plus explicitly allowed auth providers' domains for OAuth pages — but do not complete third-party OAuth in v0.1; report "uses Google sign-in; provide a test email/password account to test login"). Block/abort other navigations via request routing.
2. **No money:** never submit payment. If a page contains payment fields (card number inputs, Stripe Elements/Checkout iframes, PayPal), stop the flow and record "Reached payment — stopped by design" (Info). Never type card numbers.
3. **No destructive or outward actions:** the agent's instructions must forbid deleting data/accounts, sending messages/invites/emails to others, posting public content, changing account email/password, and confirming any "Are you sure?" dialog that deletes something. Implement an action guard that blocks clicks whose element text/label matches destructive patterns (delete, remove account, cancel subscription, send invite, publish, pay, purchase, buy now, place order, confirm payment — localized EN/DE minimum) unless clearly part of the test's own temporary data.
4. **Budgets:** global `--max-minutes` (default 10) hard stop; per-flow max agent steps (default 25); global max LLM calls (default 150). On budget hit: stop gracefully, still write the report with "partially tested".
5. **No attack payloads:** bad-input testing uses messy-but-benign data (empty, long, unicode, wrong formats). No SQL injection, XSS, path traversal or fuzzing payloads.
6. **Secrets hygiene:** never write passwords or the user's API key to disk, logs, or the report. Mask found secrets.
7. **Ownership confirmation** prompt (see §5.1) + README statement: only test apps you own or have permission to test.
8. Identify the agent: set a user-agent suffix `ShipCheck/<version> (+repo URL)`.

## 8. Architecture

**Language/runtime:** TypeScript (strict), Node.js ≥ 20, ESM. Package manager: npm.

**Key libraries (verify current versions/APIs against official docs before coding — do not rely on memory):**
- `@browserbasehq/stagehand` — AI browser automation on top of Playwright (`act`, `observe`, `extract`, `agent`). Run with a **local** Chromium (no Browserbase account needed).
- `playwright` — browser, viewports/devices, request routing (domain lock), console/network listeners, screenshots.
- `@axe-core/playwright` — accessibility.
- `commander` (CLI), `zod` (schemas), `picocolors` + `ora` or similar (terminal UX), `open` (open report).
- Build with `tsup`; test with `vitest`; lint/format with `eslint` + `prettier`.
- AI providers via Stagehand's model configuration. Support at least **Google Gemini** (default, free tier), **Anthropic Claude**, **OpenAI**. Auto-detect from env keys (`GEMINI_API_KEY`/`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — check Stagehand docs for exact env names it expects and map ours to them. Model ids must be configurable; keep defaults in one file.

**Module layout:**
```
src/
  cli.ts                 # arg parsing, confirmation, progress UI, exit codes
  config.ts              # flags + env + shipcheck.config.json → validated Config (zod)
  runner.ts              # orchestrates: session → deterministic checks → flows → mobile → judge → report
  browser/
    session.ts           # launch Playwright+Stagehand, contexts per device, domain lock, UA
    evidence.ts          # console/network capture, screenshots, action log
    guard.ts             # destructive-action + payment detection
    devices.ts           # desktop + iPhone presets
  flows/
    types.ts             # Flow interface: name, run(ctx) → FlowResult (steps, observations, evidence, status)
    landing.ts signup.ts login.ts core.ts forms.ts
  checks/
    errors.ts performance.ts https.ts headers.ts secrets.ts seo.ts links.ts a11y.ts
  ai/
    models.ts            # provider/model selection from env/flags
    prompts.ts           # all LLM prompts in one place
    judge.ts             # turns raw observations into Findings (plain English, severity, fix prompt)
  report/
    schema.ts            # Finding, Report types (zod)
    verdict.ts           # deterministic verdict + ranking
    html.ts              # self-contained HTML renderer (template literal or a tiny template lib; no React build step)
    markdown.ts          # report.md + GitHub step summary
test/
  fixtures/buggy-app/    # tiny static site with planted bugs (see §10)
  unit/ ...              # deterministic checks, secret regexes (incl. false-positive cases), verdict, config
  e2e/                   # runs ShipCheck against buggy-app (AI tests skipped without a key)
action.yml               # composite GitHub Action
examples/github-workflow.yml
```

**Data model (`report/schema.ts`):**
```ts
type Severity = 'blocker' | 'major' | 'minor' | 'info';
type Finding = {
  id: string;                  // stable hash of category+flow+title
  title: string;               // plain English
  severity: Severity;
  category: 'functional'|'mobile'|'forms'|'errors'|'security'|'seo'|'accessibility'|'performance'|'coverage';
  flow?: 'landing'|'signup'|'login'|'core'|'forms'|'mobile';
  device: 'desktop'|'mobile'|'both';
  whatHappened: string;
  whyItMatters: string;
  stepsToReproduce: string[];
  evidence: { screenshots: string[]; logs?: string[]; url?: string };
  fixPrompt?: string;
  confidence: 'verified'|'ai-judgement';
};
type Report = { meta: {...}; verdict; counts; findings: Finding[]; passed: string[]; notTested: string[]; actionLog: ActionLogEntry[] };
```

**Flow of a run:**
1. Validate URL, config, AI key; confirm ownership.
2. Launch desktop context (domain lock, listeners on).
3. Deterministic checks on landing (headers, HTTPS, secrets, SEO, raw-HTML shell, a11y, perf).
4. AI flows in order: landing → signup → login → core → forms. Each flow: screenshot at start/end and on every failure; record every action in the action log; observations are structured (expected vs actual).
5. Mobile context: landing + (login/core within budget) + layout checks (horizontal overflow via `scrollWidth > clientWidth`, overlapping/offscreen primary buttons, tap target size).
6. Collect errors/network failures throughout; attribute to flow/step when possible.
7. **Judge:** one or a few LLM calls convert raw observations → Findings (plain English, severity per §5.3, fix prompt). Deterministic checks produce Findings directly (no LLM needed, optionally LLM-polished wording). Dedupe similar findings. Rule: **no finding without evidence**.
8. Verdict + ranking → write `report.json`, `report.html`, `report.md`; screenshots embedded.
9. Print summary, exit code.

**AI rate limits (important for free-tier users):** Gemini's free tier has tight per-minute and per-day request limits that change often (some Flash models allow only ~20 requests/day on free tier; Flash-Lite models allow more). Therefore: (a) at build time, check Google's current rate-limits page and pick a default Gemini model with a usable free quota, documented in `ai/models.ts`; (b) keep LLM calls per run low — prefer deterministic code over LLM calls, batch judge calls, cache `observe` results within a run; (c) on HTTP 429, back off and retry with jitter, and if the quota is exhausted, stop gracefully and write a partial report explaining "your AI key's free quota ran out; tested X of Y flows"; (d) the README must state realistic free-tier expectations and how to switch models.

**Robustness:** each flow and check is isolated — one failing must not kill the run; record it under "What we couldn't test" with the reason. Retry flaky navigations once. Timeouts everywhere.

## 9. Design for later (v0.2+), don't build now
- **Playwright export:** keep a precise `actionLog` (step, intent in English, resolved selector/locator, action, value-redacted, URL, result). v0.2 turns it into `.spec.ts` files.
- Claude Code command / MCP server, re-check diff (compare two report.json), custom flows file, EU/Germany launch checklist (Impressum, cookie consent, privacy policy, German report), Safari/WebKit pass, test inbox for email verification, hosted version.

## 10. Testing strategy (this is a QA product — its own quality must be exemplary)
- **Fixture app `test/fixtures/buggy-app/`:** a tiny static site (plain HTML/JS, served locally by the test harness on a random port) with **planted bugs**:
  1. Signup button has no handler on mobile viewport (works on desktop).
  2. Contact form accepts empty email and a 5,000-char name.
  3. Console error thrown on landing load.
  4. One broken image (404) and one broken internal link.
  5. Missing meta description and Open Graph tags.
  6. A fake **secret** `sk_live_` string in a JS bundle *and* a public `pk_test_` key (must NOT be flagged).
  7. Login shows no error message on wrong password.
  8. A page with horizontal overflow on mobile.
  9. A "Delete account" button (the guard must never click it — assert via a server-side hit counter).
  10. A checkout page with a card field (must stop, never type card data).
- **Unit tests:** every deterministic check (true positives + false positives), secret regexes, JWT role decoding, verdict rules, config parsing, domain lock logic, action guard patterns, HTML renderer snapshot.
- **E2E:** run full ShipCheck against buggy-app. Deterministic expectations always run. AI expectations run only when an AI key env var exists (skip otherwise), and assert recall on planted bugs (target: ≥ 7/10 detected, 0 guard violations, 0 false secret flags).
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, unit tests, deterministic e2e on every push/PR; AI e2e only on manual dispatch with a repo secret.

## 11. Open-source packaging
- npm package: **`@anjalipanwar/shipcheck`** (unscoped `shipcheck` and `shipcheck-cli` are taken on npm). `bin: { "shipcheck": ... }`. `npx @anjalipanwar/shipcheck <url>`.
- Postinstall/first-run: ensure Playwright Chromium is installed (`npx playwright install chromium` with a clear message; don't silently download in CI without logging).
- Files: `README.md` (hero GIF, 3-step quickstart, what it checks, sample report link, GitHub Action usage, limits, FAQ, privacy: "runs locally; data goes only to your chosen AI provider"), `LICENSE` (MIT, © 2026 Anjali Panwar — confirm name with owner), `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, issue templates.
- Sample reports in `examples/reports/` (buggy-app + real apps the owner owns or has permission to test) and published via GitHub Pages as the project page.
- Version `0.1.0`; tag `v0.1.0`; action tag `v0` moved to latest 0.x.

## 12. Cost
Maintainer: €0/month (GitHub, npm, GitHub Pages, CI on a public repo are free). Optional custom domain ~€10–15/year, not needed for v0.1.
Users: their own AI key. Free tiers may cover only a few runs per day (see §8 rate-limit notes); paid keys cost roughly cents per run. Target: a full run uses well under the 150-call budget — measure and print the actual call count at the end of each run.

## 13. Decisions log (made during design; owner can override)
- Open source, bring-your-own-key, no hosted service — owner's decision.
- Stagehand + Playwright + TypeScript — chosen for Playwright compatibility (future export) and one language.
- Gemini as default model for free-tier friendliness; Claude/OpenAI supported — builder's call, owner agreed.
- Payment: stop before any payment entry (no Stripe test-mode completion in v0.1) — builder's call for safety; revisit in v0.2.
- OAuth-only signups (Google/GitHub): not automated in v0.1; ask user for email/password test account — builder's call.
- Report as self-contained HTML (no web server) — follows from open-source/no-hosting decision.
- **2026-11-13 (M0) — Stagehand pinned to 3.7.3, not `latest` (4.4.0).** v4 is a rewrite with no Playwright integration, no request routing and no `agent()`, and needs a system Chrome. §7 and §8 rely on Playwright, so v3 is the version that matches this spec. Details in `docs/notes/stagehand.md` — builder's call; revisit for v0.2.
- **2026-11-13 (M0) — Minimum Node is 22.12, not 20.** Node 20 reached end-of-life in April 2026, and current releases of commander, ora and `@axe-core/playwright` require Node ≥ 22. `.nvmrc` is 22; CI runs on Node 22 and 24. This overrides "Node ≥ 20" in §8 and CLAUDE.md — builder's call, owner can override (would mean pinning older library versions).
- **2026-11-13 (M0) — Flows will not use Stagehand's free-running `agent()`.** §7.3 needs a code-level veto before every click/fill; `agent()` clicks internally. Flows will use `observe()` → guard → `act(action)` instead — builder's call, to be confirmed when M4 starts.
- **2026-11-13 (M0) — Usage mistakes exit with code 2.** A missing URL or unknown flag counts as "ShipCheck itself failed" per §5.1 exit codes — builder's call.
