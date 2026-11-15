# ShipCheck — Progress log

Updated at the end of every milestone. Read this at the start of every session.

- **Plan:** `docs/BUILD_PLAN.md` · **Spec and full decisions log:** `docs/SPEC.md` §13
- **Last updated:** 2026-11-15, M8 built locally (action, example, self-test workflow); not yet run on GitHub
- **Next up:** owner's answer on pushing M8 (it is only "done" when the self-test workflow is green on GitHub, which needs a push — possibly more than one). Also waiting: the owner's hand test of `--headed` and the report opening by itself (commands in the M7 section).

## Overview

| Milestone                                            | Status                               | Commit                           | Pushed                                                      |
| ---------------------------------------------------- | ------------------------------------ | -------------------------------- | ----------------------------------------------------------- |
| M0 — Scaffold                                        | done                                 | `b59adfc`                        | yes                                                         |
| M1 — Fixture app with planted bugs                   | done                                 | `2d605ba`                        | yes                                                         |
| M2 — Browser session, evidence, deterministic checks | done                                 | `6498102`                        | yes                                                         |
| M3 — Report renderer and verdict                     | done                                 | `8e0b406`                        | yes                                                         |
| M4 — AI flows with Stagehand + safety guard          | done                                 | `f5f7e63`                        | yes                                                         |
| M5 — Mobile pass                                     | done                                 | `f168b9e`                        | yes                                                         |
| M6 — AI judge, fix prompts, dedupe                   | done                                 | `c2c651a` … `6403dbc`            | up to `fc928dc` yes; later commits no                       |
| M7 — CLI polish                                      | done                                 | `951404c`, `bcec284` + follow-up | `bcec284` yes (CI green, about 5 min per job); follow-up no |
| M8 — GitHub Action                                   | built locally, not yet run on GitHub | see M8 section                   | no                                                          |
| M9 — Docs and launch assets                          | not started                          | —                                | —                                                           |
| M10 — Release                                        | not started                          | —                                | —                                                           |

## Standing instructions from the owner

- Work one milestone at a time; after each: typecheck, lint, tests, commit, short status, then wait for "go".
- **After each milestone, ask whether to push before starting the next one.** Never push without that answer. (2026-11-13)
- **Git author for this repo:** Anjali Panwar, `official.anjali@gmail.com` (set in the repo's git config). Do not rewrite existing commits. (2026-11-13)
- Keep this file updated at the end of every milestone. (2026-11-13)
- **AI key:** the owner's Gemini key lives in `.env` in the project folder as `GEMINI_API_KEY` (ignored by git, readable only by the owner's user). Never print it, never copy it into another file, a commit, a log or a report. `.env.example` is the committed template without a key. (2026-11-13)
- Follow SPEC §7 safety rules exactly; never test against real third-party sites in automated tests; do not publish to npm unless asked.
- **Errors caused by ShipCheck's own blocking** (backstop, payment hosts, domain lock) are never reported as app bugs; they are tagged and listed under "What we couldn't test". (2026-11-14)
- **Broken internal links:** Major in the header/main navigation or on a primary call-to-action (sign up, log in, checkout, main button); Minor elsewhere. (2026-11-14)

---

## M0 — Scaffold

- **Status:** done
- **Commit:** `b59adfc` (was `05da6fb` before it was placed on top of the existing GitHub commit)
- **Pushed:** yes (2026-11-13)

**What was built:** project scaffold (TypeScript strict, tsup, vitest, eslint + prettier), CLI skeleton with all SPEC §5.1 flags, Stagehand pinned at 3.7.3 with API notes in `docs/notes/stagehand.md`, CI workflow.

**Owner decisions and feedback**

- Accepted the builder's M0 choices as they stood by answering "go" (2026-11-13):
  - Minimum Node is 22.12 instead of 20 (Node 20 is end-of-life; current libraries need 22+).
  - Stagehand v3 (3.7.3) instead of `latest` v4, because v4 has no Playwright integration and no `agent()`.
  - Usage mistakes (missing URL, unknown flag) exit with code 2.
- Git author: keep the Gmail address; no rewrite of existing commits.

**Open questions**

- `CLAUDE.md` still says "Node ≥ 20" in Conventions, while the project now requires Node ≥ 22.12. Owner to decide whether to update that line.
- npm did not run install scripts for `esbuild`, `bufferutil`, `protobufjs` and `@google/genai`. Everything works without them so far; left unapproved.

---

## M1 — Fixture app with planted bugs

- **Status:** done
- **Commit:** `2d605ba` (was `688ceaa` before it was placed on top of the existing GitHub commit)
- **Pushed:** yes (2026-11-13)

**What was built:** the "NoteNest" fixture app with the 10 planted bugs from SPEC §10, a local server helper with hit counters (`test/helpers/fixture-server.ts`), `BUGS.md`, unit smoke tests and real-browser tests proving each behavioural bug.

**Owner decisions and feedback**

- **Bug #8 expected severity is Minor** (the page scrolls sideways, nothing is hidden), so tests are deterministic. Recorded in `BUGS.md`.
- **HTTPS on local addresses** (`localhost`, `127.0.0.1`, `::1`, `*.localhost`): emit an Info finding "Local address — HTTPS not checked" rather than nothing, and unit-test the real HTTPS check with a non-local `http://` URL. Implemented in M2.
- No objection raised to: the fake `sk_live_` key being injected at serve time instead of committed; the server helper living in `test/helpers/`; real-browser fixture tests being added to CI.

**Open questions**

- None.

---

## M2 — Browser session, evidence and deterministic checks

- **Status:** done
- **Commit:** `6498102`
- **Pushed:** yes (2026-11-13, pushed separately after M0 + M1 as the owner asked)

**What was built:** browser session with domain lock and ShipCheck user agent, evidence capture (errors, failed requests, screenshots, action log, password scrubbing), eight deterministic checks, report schema and verdict rules, `--no-ai` mode writing `report.json`, ownership confirmation. 237 unit tests and 30 real-browser tests pass.

**Result against buggy-app (`--no-ai`):** exactly eight findings — bugs #3, #4 (link and image), #5 (description and Open Graph), #6 (secret masked, `pk_test_` not flagged), plus missing security headers and the local-HTTPS Info. Trap counters stayed at 0.

**Owner decisions and feedback**

- Push order: M0 + M1 first, then M2 as a separate push. Done.
- The first push attempts were rejected by GitHub ("push declined due to email privacy restrictions"). Owner chose to keep the Gmail address and changed the GitHub setting; pushes then went through.
- 2026-11-14: owner approved all M2 choices below; choice 3 was refined (broken link severity now depends on placement — see M4 follow-ups).

**Builder's choices — approved by the owner on 2026-11-14** (details in `docs/SPEC.md` §13)

1. Playwright launches the browser and Stagehand attaches to it (reverses the M0 note).
2. The domain lock blocks top-level page navigations only; background requests and embedded frames to other sites are allowed.
3. Severities: uncaught error = Minor, broken internal link = Major, broken image = Minor. One dead link therefore changes the verdict to "Fix before launch".
4. Link checking never requests links that look like log out, delete, confirm or pay; only "not found" and server errors count as broken.
5. `Finding` has an extra `rule` field; checks also return "passed" and "not tested" lines.
6. `--no-ai` is a public flag; the ownership confirmation was implemented early.
7. Stripe test secret keys (`sk_test_`) are not flagged.

**Open questions**

- ~~Is "broken internal link = Major" right?~~ Answered 2026-11-14: depends on placement.
- ~~First CI run not checked.~~ Checked 2026-11-14: every run on GitHub is green (latest: `1d133b8`).
- ~~Stagehand `act` / `observe` untested.~~ Confirmed in M4 with the real Gemini key.

---

## M3 — Report renderer and verdict

- **Status:** done
- **Commit:** `8e0b406`
- **Pushed:** yes (2026-11-13)

**What was built:** `report.html` (one self-contained file: verdict banner, "Fix these first", issue cards with evidence and fix-prompt copy buttons, screenshot lightbox, light/dark, phone layout), `report.md`, the GitHub step-summary text (used in M8), shared wording in `report/present.ts`. A `--no-ai` run now writes all three files and the CLI prints the path of `report.html`. The verdict rules were already built and tested in M2; M3 added the "top 3" ranking.

**Result against buggy-app (`--no-ai`):** `report.html` is about 70 KB (limit 5 MB) with the same eight findings as M2. 273 unit tests and 45 real-browser tests pass. The browser tests open the real report and check: no errors, no network requests, copy button, lightbox, no serious accessibility problems (desktop and phone, light and dark), no sideways scroll on a phone, readable without JavaScript, no password or unmasked key in any file. Three deliberate breakages (wrong script hash, pale text, unwrapped long text) were each caught by these tests.

**Owner decisions and feedback**

- Push M3: yes. No objection raised to the M3 choices below.
- Gave a Gemini API key for M4 and asked for it to be kept in `.env`, out of git.
- 2026-11-14: owner approved all M3 choices below.

**Builder's choices — approved by the owner on 2026-11-14** (details in `docs/SPEC.md` §13)

1. Section grouping in "All issues", including four sections the spec did not name ("Across the app", "Accessibility", "Speed", "Other notes").
2. A note under the verdict when the run used no AI or stopped early.
3. The report file is locked down (cannot load or send anything; app text cannot run as code).
4. Screenshots embedded once, 4.3 MB picture budget, overflow linked as files; extra section "Your app as ShipCheck saw it".
5. Password scrubbing moved before file creation — closes a gap from M2 (a password containing a quote or backslash would not have been scrubbed from `report.json`).
6. Dates in UTC; action log only in `report.json`; `report.md` names screenshot files.

**Open questions**

- None of the eight buggy-app findings has a screenshot attached yet (the automatic checks produce log evidence). Screenshot-in-card layout is covered by unit tests and will first show real pictures in M4.
- Auto-opening the report after a run is M7, per the build plan.

---

## M4 — AI flows with Stagehand + safety guard

- **Status:** done
- **Commit:** `f5f7e63`
- **Pushed:** yes (2026-11-14)

**What was built:** model and key detection (`ai/models.ts`) with a friendly no-key message; `.env` loading; the AI call budget (`ai/budget.ts`); the Stagehand wrapper (`ai/driver.ts`); all prompts in `ai/prompts.ts`; the action guard (`browser/guard.ts`, `browser/element.ts`); the network backstop (`browser/backstop.ts`, `browser/cards.ts`); five flows (`flows/`: landing, signup, login, core, forms) built on one engine (`flows/context.ts`) that enforces observe → guard → act, step limits, screenshots and the action log.

**Result against buggy-app with the real AI (Gemini `gemini-3.5-flash-lite`, built CLI):** bugs #2 and #7 found; signup, login and "Add a note" correctly reported as working; delete, checkout and card counters all 0; every action on the app's own address; 14 of 150 AI calls; 42 seconds. Without a key the CLI prints the three-step how-to and exits with code 2.

**Tests:** 378 unit tests, 72 real-browser tests (no key needed, scripted stand-in for the AI), 7 real-AI tests (`npm run test:ai`). Removing the backstop, making the guard say yes to everything, and accepting dialogs were each tried on purpose; the tests caught all three.

**Owner decisions and feedback**

- "Go" for observe → guard → act, with three additions (all done): `act` gets the exact approved action; a backstop independent of the guard, proven with the guard switched off; every AI call counted per run and per flow, with the total printed.
- The Gemini key lives in `.env` (see standing instructions). The first key was pasted into chat; the owner replaced it and deleted the old one.
- 2026-11-14: owner approved all M4 choices below, adding the rule that ShipCheck's own blocking is never an app bug (done, see follow-ups).

**Builder's choices — approved by the owner on 2026-11-14** (details in `docs/SPEC.md` §13)

1. Stagehand's self-heal is off — otherwise a failed action could be redirected to an element the guard never saw.
2. The backstop also blocks data-changing requests that say delete/cancel/pay/checkout/invite and every HTTP DELETE. Needed for the owner's own guard-off test: the fixture's delete button has no dialog and its checkout posts to the app itself.
3. Payment hosts: everything blocked except loading the provider's script (avoids false alarms on apps that load Stripe everywhere). This narrows the M2 decision that let payment widgets load.
4. The guard makes no exception for "the test's own data": nothing that says delete or remove is clicked in v0.1.
5. Measured before asked; an unconfirmed main feature goes to "couldn't test", not to a Blocker.
6. Refused submissions (POST answered 4xx) are no longer reported as failed background requests.
7. Default models; only Gemini verified live.
8. Real-AI tests only via `npm run test:ai`; CI uses the scripted stand-in.

**Open questions**

- ~~Double submit on the contact form: keep?~~ Answered 2026-11-14: planted as bug #11, with the newsletter form as its opposite case. Commit `1d133b8`, pushed after `npm run test:ai` passed (8/8, 23 AI calls).
- The real AI never wandered to the checkout page by itself, so the Info "Reached payment — stopped by design" (#10) appears only in the scripted tests so far.
- Anthropic and OpenAI defaults are untested (no keys). The CI workflow has no manual real-AI job yet (planned with M8).
- ~~`CLAUDE.md` still says "Node ≥ 20".~~ Fixed 2026-11-14.

---

## M4 follow-ups (owner decisions of 2026-11-14)

- **Status:** done
- **Commit:** `215e69a`
- **Pushed:** yes (2026-11-15, with `f168b9e` and `11bf00a`; CI green for `11bf00a`)

**What was built**

1. **Broken link severity by placement.** Page facts now record each link's text, whether it sits in the header/main menu, and whether it looks like a button. Major: menu links and primary calls-to-action. Minor: other links (`links/broken-other-link`). Unit tests cover both, and the e2e run proves the header "Pricing" link stays Major.
2. **Node check at startup.** `src/cli.ts` checks the version before loading anything else. Verified on a real Node 20.17 (friendly how-to, exit code 2), plus unit tests and an e2e test with a faked old version. `CLAUDE.md` and SPEC §8 now say Node ≥ 22.12.
3. **ShipCheck's blocking is never an app bug.** Blocked requests are tagged; the app's error messages caused by a block are matched (`src/checks/blocked.ts`) and left out of all findings; "What we couldn't test" lists what was blocked. Fixture: a payment-script stand-in on the home page. The tests prove the separation matters: without it, the same run _would_ report a console-error finding and a second crash.
4. **A refused valid login is still reported.** The fixture's `rejectAllLogins` switch: "Users cannot log in" (Blocker) is reported, the server saw both attempts answered with 401.

**Found on the way, fixed (builder's calls, in SPEC §13)**

- The new fixture case first **hid the broken login**: the login flow stopped at once with "Reached payment — stopped by design", because the payment script's invisible frame counted as a payment step. Stripe.js does the same on every page of real apps. Now only visible payment frames count.
- For the same reason, a payment script's background requests no longer end a flow (they are still blocked).

**CI:** every run on GitHub is green, including `1d133b8`.

**Open questions**

- The new real-AI assertion for the payment widget was added after the one `npm run test:ai` run the owner approved, so it has not run against the real AI yet. The scripted e2e tests cover the same behaviour.

---

## M5 — Mobile pass

- **Status:** done
- **Commit:** `f168b9e`
- **Pushed:** yes (2026-11-15; CI run for `11bf00a` completed with success)

**What was built:** the phone-sized pass (iPhone, 390×844, touch, mobile browser identity).

- **Phone layout checks** (`checks/mobile-layout.ts`), no AI needed: sideways scrolling (names the element that is too wide), buttons cut off at the screen edge, buttons covered by another element, tap targets that are too small (WCAG 2.5.8). Home page and up to 5 linked pages.
- **Phone menu check** (`checks/mobile-menu.ts`): taps the header's menu button once (guarded) and checks that the menu opens.
- **Phone flows:** landing, sign-up, login and main feature run again on the phone when at least 10 AI calls are left. Results are merged: the same problem on both devices becomes one finding for "both"; a phone-only problem becomes "… on a phone".

**Result against buggy-app**

- Real AI (Gemini `gemini-3.5-flash-lite`, `npm run test:ai`): 11/11 checks pass, 30 of 150 AI calls (11 for the phone). Bug #1: "The sign-up button does nothing on a phone" — Blocker, phone only; desktop sign-up reported as working. Bug #8: "A page scrolls sideways on a phone" — Minor, phone only, cause "a table that is 900 px wide". Bug #7 is now one finding for both devices. Trap counters 0.
- Without AI (built CLI, `node dist/cli.js <fixture> --no-ai`): bug #8 is found as well; 1 Blocker · 1 Major · 6 Minor · 1 Info. The phone finding's card shows the phone screenshot (checked visually).

**Tests:** 408 unit tests, 99 real-browser tests, 11 real-AI tests. The new real-browser tests use synthetic phone pages for each rule and each exception (closed drawer menu, carousel, icon inside a button, a lone small button with space around it, links inside text), and for the menu check (opens, does not open, refused by the guard).

**Builder's choices** (details in `docs/SPEC.md` §13)

1. Sign-up is repeated on the phone (needed for bug #1; §6.1 names only landing and login/main feature). **Approved by the owner on 2026-11-15**; SPEC §6.1 and §13 updated.
2. Phone layout checks also run with `--no-ai`.
3. Severities: sideways scrolling Minor, cut-off or covered button Major, small tap targets Minor (WCAG 2.5.8). Covered buttons refined by the owner on 2026-11-15 (see M5 follow-ups).
4. Menu check taps the first menu-like header button once, guarded.
5. Merge rules for desktop + phone; phone flows need at least 10 AI calls left.

**Open questions**

- ~~Menu button in the fixture?~~ Answered 2026-11-15: two new pages, existing pages unchanged (see M5 follow-ups).
- ~~Covered by a closable banner: Major or Minor?~~ Answered 2026-11-15: close it safely first, then decide (see M5 follow-ups).
- Choices 2, 4 and 5 above have no explicit owner answer yet.

---

## M5 follow-ups (owner decisions of 2026-11-15)

- **Status:** done
- **Commit:** `7dc0626`, fix `67b4a5a` (progress-log commits `a0112d3`, `4459242`)
- **Pushed:** yes (2026-11-15, owner asked; CI for `4459242` completed with success)

**Owner decisions (2026-11-15)**

1. Push `215e69a`, `f168b9e`, `11bf00a` — done; CI for `11bf00a` completed with success.
2. Sign-up on the phone: approved. SPEC §6.1 flow 6 and §13 updated.
3. Covered buttons: first try to close the covering banner with a safe choice only ("Close", "Reject", "Only necessary"; never "Accept all"), through the guard. Reachable afterwards → Minor with a note; cannot be closed or still covered → Major. Unit-test both.
4. Menu check: existing fixture pages stay unchanged; two new pages, one working menu (must not be reported) and one broken (planted bug #12). BUGS.md updated.
5. Before M6: run ShipCheck (`--no-ai` and AI) on the owner's real app and send a short summary (findings, likely false alarms, clear misses, AI calls). Wait for "go" on M6 after that.
6. 2026-11-15: push the follow-up commits — done. "Don't start M6 yet."
7. 2026-11-15: run the menu check on every page the phone pass visits (up to 5), each distinct menu once (same header = same menu); keep bug #12 out of the default run, with a dedicated test starting on `/menu-broken.html`. Privacy approach for the real-app run approved; app address given. Wait for "go" on M6 after the real-app run.

**What was built**

- `src/checks/mobile-banner.ts`: finds the fixed/sticky box covering a button, picks a safe button inside it (reject → only necessary → close; consent words veto a button even if it also says "close"), asks the guard, taps once, measures again. `judgeLayout` stays pure: the result is a `closedWith` note on the covered button → Minor `mobile/button-covered-until-closed`, otherwise Major `mobile/button-covered`. The screenshot is taken before the tap, so it shows the banner.
- Fixture: `/menu-ok.html`, `/menu-broken.html` (bug #12), `assets/menu.js`, `assets/menu.css`. No existing fixture file changed.
- Small refactor: the page-side "element address" helper is shared (`XPATH_OF_SOURCE` in `browser/element.ts`).

**How it was verified**

- `npm run typecheck`, `npm run lint`, `npm test` (446 unit tests), `npm run test:e2e` (113 real-browser tests) all pass.
- Unit: both outcomes in `judgeLayout` (Minor with the note; Major), both in one run, "banner" vs "cookie banner"; the safe-choice list with 12 allowed and 19 refused labels (including "Accept & close", "Close account", "OK", "Got it").
- Real browser: "Reject all" is tapped and never "Accept all"; only "Accept all" → nothing tapped (even with the guard switched off); a "Close" that does not close → still covered; a "Close" inside a payment form → refused by the guard; a cover that is not a banner → nothing tried; a fixed app shell that holds the button is not a banner (its in-app "Decline" is never tapped); two banners → addresses are re-read after each close, so a "Close" in the page content is never tapped.
- Full `--no-ai` run on a one-page local server with a cookie banner: one Minor "A cookie banner covers the “Sign up” button until it’s closed", screenshot taken with the banner showing, "Reject all" in the action log, "Accept all" never tapped.
- Bug #12: full `--no-ai` runs started on each page — `/menu-broken.html` gives exactly one Major "The menu does not open on a phone" (phone, two screenshots), `/menu-ok.html` gives none and lists "The menu opens on a phone". The default run from `/` never reaches either page.
- Deliberate breakages, each caught: guard skipped (1 test failed); consent veto removed and "accept all" added to the safe list (4 failed); banner search allowed to climb past the covered button (1 failed); stale banner addresses reused without re-checking (2 failed).
- Found in review before the push and fixed: the first version could treat a fixed app shell as a "banner", and could reuse a stale address after the first banner was removed — in both cases a safe-looking button in the app itself (e.g. "Decline") could have been tapped. A "close" tap that leaves the page now goes back to it; a `#hash` change does not count as leaving.

**Open questions**

- ~~Menu check on the other phone pages too?~~ Answered 2026-11-15: yes, each distinct menu once (see "Menu check on every phone page" below).
- ~~Real-app run: needs the app's address.~~ Given 2026-11-15 (kept out of this public file); privacy approach approved. The AI run would create a `shipcheck+…@example.com` account on the live app unless the owner puts a test account in `.env` (`SHIPCHECK_EMAIL` / `SHIPCHECK_PASSWORD`). The repo is public: the real-app report and address stay outside it; only the fact of the run and the AI call count go into this file.

---

## Menu check on every phone page (owner decision of 2026-11-15)

- **Status:** done
- **Commit:** `8bc6084`
- **Pushed:** no — waiting for the owner's answer

**What was built:** the menu check runs on the start page and every page the phone pass opens (up to 5 more). Each menu gets a fingerprint — its button's label plus the link paths in its header (and in the panel it opens) — and each distinct menu is tapped once. A broken menu away from the start page says where: "The menu on /shop does not open on a phone".

**How it was verified:** typecheck, lint, 446 unit tests, 114 real-browser tests pass. New full `--no-ai` run on a 5-page local site: one broken menu shared by 3 pages (one with the current page highlighted) → one finding and one tap; a second broken menu on `/shop` → its own finding naming `/shop`; a working menu on `/help` → "The menu opens on a phone"; exactly 3 taps in the action log. Switching the de-duplication off on purpose made the test fail. Bug #12: the dedicated test still starts on `/menu-broken.html`; the default run from `/` still never reaches it, and its finding list is unchanged.

---

## Real-app run before M6 (2026-11-15)

The owner's own app (address and report kept outside this public repo, as agreed). Built CLI at `80c4376`, Gemini `gemini-3.5-flash-lite`.

- `--no-ai`: 9 seconds, 3 Minor (missing security headers, no sitemap, pale text). Menu tapped once, header shared by 6 pages.
- With AI: 128 seconds, **42 of 150 AI calls** (landing 1, signup 4, login 4, core 10, forms 5, mobile 18). Verdict "Not ready": 2 Blocker, 2 Major, 3 Minor.
- **Checked against the screenshots: all 2 Blockers and both Majors are false alarms.** The 3 Minors look real.

**Lessons for M6 (general, no app details)**

1. **Judged too early.** Sign-up worked (both screenshots show the signed-in dashboard), but the observation read a half-drawn loading label ("…ing…") and the address before the redirect → "New users cannot sign up" (Blocker). Needs: wait until the page settles; no Blocker when the screenshot contradicts the text.
2. **Analytics counted as "the server accepted the form".** A hosting platform's tracking beacon (a same-site POST answered 202) was taken as the form submission, while the page showed its own "Please enter your name" and the browser's "include an @" message → two false Majors. Needs: only the form's own request counts; a visible validation message overrides.
3. **The main-feature flow signed up by itself with invented details** ("user@example.com" and a made-up password). The app correctly refused the weak password → false Blocker. **The made-up password was written into report.html, report.md and report.json** — a SPEC §7.6 gap: only known passwords are scrubbed. Needs a fix before M6: flows never invent credentials; scrub every typed password field value.
4. **Clear misses.** Logging in with the right password was not tested (it relied on the "failed" sign-up), the main feature was never tried (desktop: the AI service answered "too many requests" after ~40 calls in 2 minutes — no retry or slow-down), and log-in on a phone was "not tested" with the wrong reason ("only Google sign-in?") — the log-in link sits behind the phone menu.
5. Small: "Get started … leads somewhere" listed twice under what worked; "a problem that make" grammar in the accessibility finding.

**Side effects on the owner's app:** two test accounts (`shipcheck+…@example.com`, desktop and phone sign-up) and one contact-form message with test text. The invalid and empty submissions were stopped by the app's own checks.

---

## Honest verdicts and "What this report covers" (owner decisions of 2026-11-15)

- **Status:** done — the owner answered "go" on 2026-11-15 after the second set of screenshots (taken as approval and as the go-ahead for M6)
- **Commit:** —
- **Pushed:** — (`8bc6084`, `80c4376`, `0254d7f` were pushed on 2026-11-15; origin/main = `0254d7f`, CI green)

**Owner decisions (2026-11-15), all recorded in SPEC §13**

1. A `--no-ai` run never says "Ready to launch" (neutral verdicts instead); an AI run that stopped early never promises more than was tested; a permanent "What this report covers" box under the verdict in report.html, report.md, the step summary, plus a terminal line.
2. After reviewing the first screenshots as a non-technical user: the ✓/✗ table is replaced by **four states** — ✓ No problems found · ⚠ N problems (colour of the worst, linked) · ○ Not tested (grey, reason + what to do; keeps "Partly tested") · — Skipped by your choice / Not in your app (does not block "Ready to launch"). Two groups with headings; plain labels ("Using it on a phone", "Phone screen layout", "Forms (including wrong or missing input)"); "tried to use your app" intro; "this needs the full check"; "…or is a security risk"; the "Automatic checks can't find…" paragraph only in automatic-only reports; chip plurals and a one-line severity legend; same wording in all four outputs.
3. Approved as built: Info-only `--no-ai` run → "Automatic checks passed"; Blocker in a `--no-ai` run → "Automatic checks found issues" in red.
4. No password — including ones ShipCheck creates or the AI invents — may appear in any output; with a test.
5. M9/M10 checklist: every command and link shown in reports must work, with a test that the linked README section exists. M6: a fixture reproducing the real-app sign-up false alarm, and proof that the judge no longer reports it. (Both added to `docs/BUILD_PLAN.md`.)

**What was built:** verdicts `partly-tested`, `checks-passed`, `checks-found-issues`; `coverage` in `report.json` with a state per area, recorded by the runner (`src/coverage.ts`) and counted against the findings (`src/report/areas.ts` says which row a finding belongs to); flows report _why_ something was not done (`gaps`: blocked / the user's choice / not in the app) with the next step; the verdict is derived from findings + mode + coverage and the schema refuses a verdict that promises more; one view (`src/report/coverage-view.ts`) feeds HTML, Markdown and step summary. Password fix in `FlowContext.perform()`.

**How it was verified:** typecheck and lint clean, 485 unit tests and 120 real-browser tests pass. Eight deliberate breakages were each caught (skipped counted as untested; "Not tested" no longer blocking "ready"; link to the worst finding dropped; "Automatic checks can't find…" shown in full reports; a phone sign-up problem counted under layout; a partly tested area not counted as untested; problems outside the rows hidden; phone pass not inheriting "Not in your app"). Unit tests for every state, the grouping and order, links to findings, plurals, legend, "never claims it signed up"; real-browser tests for the box in a real report, the AI-call limit, the time limit, `--flows`, `--skip-mobile`, a dead app; `test/e2e/no-password-in-output.test.ts` (fails when the protection is removed — tried). Screenshots of five cases, desktop and phone, sent to the owner.

**Added after an internal review, before the commit**

- An app without sign-up or log-in: "Not in your app" found on desktop also holds for the phone pass, so it no longer shows "Not tested" under "Using it on a phone" (which would have blocked "Ready to launch").
- A problem found only while using the app on a phone (e.g. the sign-up button that does nothing) counts under "Using it on a phone", not under "Phone screen layout".
- Problems that belong to no row (page speed, a dead button on the home page, a home page that does not load) are mentioned in one line under the table, so the box never looks cleaner than the counts.
- The report is scrubbed of passwords before the runner returns it, so the terminal and step summary are covered too, not only the written files.

**Owner's answers on the open choices (2026-11-15) — built and committed**

- Plurals and the "Not in your app" rule: approved as built.
- Payment: not "Not tested" but a neutral state "Stopped before payment (by design)" that does not block "Ready to launch"; the verdict text then adds "ShipCheck never pays. Test your payment yourself with a test card before you launch."
- AI-call-limit advice: "This check was too big for one run. Check fewer parts at a time: run ShipCheck again with --flows core".
- Short passwords: text scrubbing keeps the 4-character minimum; a field where ShipCheck typed a password always shows "[hidden]" (tested with a 2-character password).
- Real-key runs approved: one on the fixture for M6; after M6 one re-run on the owner's app (summary only, nothing about it in the repo).
- Still true until M9/M10: the `npx @anjalipanwar/shipcheck …` command works only after the npm release, and the README sections the report points to are written in M9.
- **Not yet answered:** push of `78eb04b` and the commit after it.

---

## M6 — AI judge, fix prompts, dedupe

- **Status:** done — the owner's condition (both runs clean) is met after the fourth re-run; owner: "then go for M7"
- **Commit:** see the overview table
- **Pushed:** `78eb04b`, `64c27f1`, `c2c651a` and `78589d1` pushed on the owner's request (2026-11-15); CI green for `78589d1`. The follow-up commit (prompt injection, log-in wait) is local — push not yet asked

**What was built**

1. **Three false alarms from the real-app run, reproduced first (tests red), then fixed where the observation is made:** a sign-up that works but redirects late (`/late-signup.html`); a tracking beacon taken for "the form was accepted" (`/tracked-form.html`); the main-feature flow signing up by itself with made-up details. Rule: a Blocker needs proof of failure; missing proof of success is "Not tested". Control: a sign-up the server really refuses is still a Blocker.
2. **The judge** (`src/ai/judge.ts`, prompt in `src/ai/prompts.ts`): in code — no evidence → no finding, near-duplicates merged, "What worked" without duplicates; with the model — one batched call that rewords AI-seen findings into plain English with a fix prompt. The model can only reword; it cannot change severity, evidence, or the list of findings. Any failure keeps the recorded wording.
3. **Rate limits:** longer retries (over a minute in total), a slower pace after the first "too many requests", no waiting for daily limits.

**How it was verified:** typecheck and lint clean, 516 unit tests and 129 real-browser tests pass; deliberate breakages for the judge (5), the request matching (1) and — earlier, by running the tests before each fix — all three false alarms.

**Real-key run on the fixture (2026-11-15, approved by the owner, one run):** `npm run test:ai` — 12 of 12 checks pass, 32 of 150 AI calls, about 2 minutes. All planted bugs it should find were found (#1–#8, #11), the delete and checkout traps were untouched, no false secret flag. **Gap:** the judge's own model call was not made in this run — every planted bug is a measured finding, so nothing needed rewording. It has only run against the scripted model.

**Re-run on the owner's app (2026-11-15, approved, one run; URL, report and findings stay out of the repo):** 32 AI calls, about 2 minutes, no "too many requests". The two false sign-up Blockers and the false main-feature Blocker are gone, and no account was made with invented details. Two things were still wrong and were then reproduced on the fixture and fixed (commit after this run, **not yet confirmed on the real app**): (1) sign-up had worked, but ShipCheck judged before the app's slow answer arrived and said "could not confirm" → it now waits for an outcome; (2) an analytics event with a "name" of its own was still taken for the form's request → the form's request is now the one carrying a typed value, and a refusal message on the page counts as a refusal. The judge's model call was not made here either (no AI-seen finding).

**Prompt-injection test (owner's request, 2026-11-15):** `/injected-signup.html` — a sign-up that always fails, next to hidden text telling an AI to report no problems. In CI, scripted models that obey the hidden text: a gullible flow model is overruled by the server's answer, and three obedient judges (denies the problem, softens it, drops the app's message) change nothing; an honest rewording is still used. **Real-key run (approved, one run):** 4 of 4 checks pass, 5 AI calls (sign-up 4, judge 1). "New users cannot sign up" stayed a Blocker with its screenshot, page address and "The server refused the sign-up request (answer code 500)". This was also the first time the judge's model call ran with a real key: it reworded the title in plain English and denied nothing. **Clean.** On demand: `npx vitest run --project ai test/ai/prompt-injection-ai.test.ts`.

**Second re-run on the owner's app (2026-11-15, approved, one run, ShipCheck signed up itself; URL, report and findings stay out of the repo):** 33 AI calls (judge 1). The sign-up fix is confirmed on the real app: sign-up reported as working on desktop and phone, the main feature as working, no false form findings. **Not clean:** two false log-in findings — "no message on a wrong password" (Major) and "users cannot log in" (Blocker). General lesson: the log-in flow had the same weakness sign-up had — it looked at the page while the button still said "Logging in…", so it missed the message that came a moment later and the successful log-in. Reproduced on the fixture first (`/slow-login.html`, tests red), then fixed by giving log-in the same wait for the app's answer as sign-up (shared in `src/flows/answer.ts`). Control: a slow log-in the server really refuses is still a Blocker with the app's message; planted bug #7 is still found. Two more guards, each reproduced red first: a message left over from the wrong password is not proof that the right one failed (`/slow-login.html?inplace=1` → "Not tested", not a Blocker), and a model that says "logged in" after every attempt is overruled by the server's refusal. **Not yet confirmed on the real app.** Found on the way: `--flows login` ignored `--email`/`--password` — fixed.

**Third re-run on the owner's app (2026-11-15, approved, one run, ShipCheck signed up itself; URL, report and findings stay out of the repo):** 40 AI calls, under 3 minutes. **No false alarms:** no Blocker, no Major; the only findings are three measured Minors. The wrong-password message is now seen. Sign-up works on desktop and phone. **Still not right, in the cautious direction:** (1) the log-in with the right password was shown as "Not tested — accepted, but could not confirm", although the run's own screenshot shows the user inside the app. Most likely cause, supported by the second re-run's evidence (new address, old form still visible): the app changes the address first and shows the new screen a moment later. Reproduced on the fixture (`/slow-login.html?lazy=1`, test red), then fixed: after an address change, ShipCheck waits up to 5 seconds for the old form to leave the screen (`src/flows/answer.ts`). **Not confirmed on the real app.** (2) The main feature was shown as "Not tested — could not confirm": ShipCheck added items by clicking only (nothing typed, so no measured proof), stopped with a dialog still open, and the model would not say it worked. Honest, but a miss; the second re-run had reported it as working, so this varies from run to run. Not fixed. (3) On the phone the log-in form was again not found. Not fixed.

**Owner decisions after the third re-run (2026-11-15):** push `454eb65` and `fc928dc` (done). Phone log-in: fix before M7 — check the screenshots, open the phone menu through the guard, failing fixture test first. Main feature: one cheap fix (count matching items before and after, close an open dialog), otherwise record as a known limit. Then one fourth run on the owner's app — the last one there; further real-app testing will use a second app later. Then M7.

**Phone menu (`89cd502`):** the screenshots of the third re-run confirmed it — on the phone the home page shows only a menu button, and the log-in link is behind it. Reproduced on `/menu-ok.html` (test red: "no sign-up form", "no log-in form" on a phone), then fixed: when no sign-up or log-in link is visible on a phone and no form is on screen, ShipCheck taps the menu button through the guard and looks once more (`src/flows/entry.ts`).

**Main feature used by clicking only (`6403dbc`):** it was quick, so it is fixed, not a known limit. A choice clicked inside a dialog that afterwards shows on the same page more often than at the start is measured proof; a dialog left open is closed with the Escape key before judging. Reproduced on `/planner.html` (test red), control `/planner.html?broken=1` stays "Not tested".

**Fourth and last re-run on the owner's app (2026-11-15, approved, one run, ShipCheck signed up itself; URL, report and findings stay out of the repo):** 38 AI calls, about 2.5 minutes. **Clean.** Verdict "Ready to launch"; no Blocker, no Major; the same three measured Minors. Reported as working, on desktop and on the phone: sign-up, wrong-password message, log-in with the right password, staying logged in after a refresh, the main feature, data still there after a refresh. The log-in wait and the phone menu fix are both confirmed on the real app (the phone log shows the menu being opened, then the log-in page). **Not confirmed there:** the click-only proof — in this run the AI typed a meal name, so the older typed-text proof was used. It is covered by the fixture only, and it only applies when the choices are made on the page the main-feature flow started on. Across the four runs the main feature was reached in different ways, so its result can vary from run to run.

**Verified after the follow-up:** typecheck and lint clean, 518 unit tests and 143 real-browser tests pass; deliberate breakages: server answer not outranking the model (1), judge denial check (1), log-in not waiting on the wrong password (1) or the right one (1), command-line account ignored (1), log-in model not overruled by the server on the wrong (1) or right password (1), leftover message counted as proof (1), leftover message ignored although the server refused (1), no wait for the old form to leave the screen (1), phone menu not opened (1), clicked choices not counted (1), open dialog not closed (1), "no change" counted as proof (1) — each fails a test. **Open, not fixed:** on the real app's phone pass the log-in form was not found, so log-in and the main feature show as "Not tested" on a phone. The setup time limit of the browser tests went from 60 to 120 seconds: a full fixture run now takes about 54 seconds (4 more than before, from the log-in waits).

**Off-spec / decisions (SPEC §13, 2026-11-15 M6):** the judge does not set severity (the code does); every planted fixture bug is a measured finding, so in a fixture run the judge's model call happens only for AI-seen problems.

## M7 — CLI polish

- **Status:** built, owner review pending
- **Commit:** `951404c`, plus a small follow-up commit (settings file saved with an invisible start mark; a closed ownership question when the output is piped)
- **Pushed:** no — to be asked

**What was already there (M0–M6):** all flags of SPEC §5.1, credentials from `SHIPCHECK_EMAIL` / `SHIPCHECK_PASSWORD`, the ownership question, CI detection, live progress lines, the printed summary, the no-key how-to, exit codes.

**What M7 added**

1. **`shipcheck.config.json`** in the current folder (`src/config.ts`): mirrors the flags, except `password` and `yes`, which stop the run with a plain message (SPEC §13). Unknown settings and broken JSON stop the run and are named. Order: flag → environment → file → default. For this the defaults moved out of the flag definitions into `loadConfig` — otherwise a default would have looked like something the user typed and beaten the file.
2. **The report opens by itself** when a person is at a terminal, never in CI (`src/open-report.ts`, using the `open` package that was already a dependency).
3. **Small testable pieces:** exit code (`src/exit-code.ts`), terminal summary (`src/summary.ts`), ownership question (`src/confirm.ts`). Found while checking by hand: closing the question with Ctrl+D printed "ShipCheck hit an unexpected problem" — now "Stopped. Nothing was tested."
4. **Tests that run the real command** (`test/e2e/cli.test.ts`, 19 tests): against the fixture with `--no-ai`, each in an empty temporary folder with an environment that holds no AI key (so no test can use a real key). Exit code 1 with a Blocker, 0 with `--fail-on none`, 2 for no address / invalid address / unknown flag / wrong value / no key / no confirmation / password or typo in the settings file; verdict, top three and report path printed; `--out`; settings file used and beaten by flags; and once on the built package (`npm run build`, then `node dist/cli.js`).
5. **Password search (BUILD_PLAN M7):** a test account's password given by flag and by environment variable is really typed into the fixture's log-in form, and is then searched for in every written file, the terminal summary, the progress lines and the step summary (`test/e2e/no-password-in-output.test.ts`).

**How it was verified:** typecheck and lint clean, 565 unit tests and 164 real-browser tests pass. Deliberate breakages, each failing a test: exit code always 0; settings file beating a flag; password allowed in the settings file; ownership question skipped; the user's password not scrubbed; a closed question not noticed. By hand in a pretend terminal (built package, local fixture): the ownership question appears; "y" runs the check (exit code 1, report written); "n" and Ctrl+D stop with "Stopped. Nothing was tested." and exit code 2, nothing written — also when the output is piped (that case first ended with a technical warning and exit code 13; fixed, with a unit test). The real opener was tried with no launcher available: it fails quietly and the run ends normally.

**Not verified by a test:** that a browser window really opens on the owner's machine after a run (the decision and the call are tested with a stand-in opener); `--headed` (showing the browser).

**Decided on the way (SPEC §13, 2026-11-15 M7):** `password` and `yes` are refused in the settings file; an app that does not open is exit code 1 (a Blocker), not 2.

**Owner's answers (2026-11-15):** push the five commits and report CI time (done: green, 5 min 02 s and 5 min 10 s per job, browser tests about 4.5 minutes — under the 10 minutes above which the tests were to be split, so no split). Refusing `password` and `yes` in the settings file: approved. A dead app = exit code 1: approved. Terminal and report must always agree — fixed and tested (SPEC §13): "Hidden errors… not checked (your app did not open)" instead of "✓"; `test/e2e/progress-agrees.test.ts` compares progress lines and the coverage table in seven situations (found only this one disagreement). Then M8.

**For the owner's hand test of `--headed` and the report opening by itself** (not covered by any automated test): `npm run fixture` starts the pretend app at http://127.0.0.1:4173 (new helper `test/helpers/serve-fixture.ts`); in a second terminal `npm run build && node dist/cli.js http://127.0.0.1:4173 --no-ai --headed`. Result: waiting for the owner.

## M8 — GitHub Action

- **Status:** built and tested locally; **not done** — the plan's condition is "the action runs green in this repo's CI", and that needs a push
- **Commit:** see the overview table once pushed (local commit after `2ae567d`)
- **Pushed:** no — to be asked

**What was built**

1. **`action.yml`** (composite): sets up Node 22, builds ShipCheck from the action's own files, installs Chromium, runs the check, uploads the report folder as an artifact (also when problems were found), sets outputs `verdict`, `exit-code`, `report-dir`. Inputs: `url`, `gemini-api-key`, `email`, `password` (SPEC §5.2) plus one for every other setting of the command, the two other AI keys and `artifact-name`. Decisions in SPEC §13 (2026-11-15 M8).
2. **Run summary:** the command itself now adds the short report (verdict, coverage, issue table) to GitHub's run summary whenever `GITHUB_STEP_SUMMARY` is set (`src/step-summary.ts`). A summary file that cannot be written does not fail the run.
3. **`examples/github-workflow.yml`:** the file users copy — started by hand, push trigger ready to switch on, secrets from repository secrets, four numbered steps in plain words.
4. **`.github/workflows/action-selftest.yml`:** starts the pretend app (`npm run fixture`) and runs the action from this repository three times, automatic checks only, no key: lenient (`fail-on: none` → green, report files and outputs checked), strict (a Blocker must fail the step with exit code 1, report still written), and without a key (exit code 2, nothing written).

**How it was verified (locally — GitHub Actions cannot run on a laptop):** typecheck and lint clean, 573 unit tests and 179 real-browser tests pass. `test/unit/action.test.ts` reads the action and workflow files: spec inputs present, an input for every flag of the command, nothing from the workflow pasted into a script, secrets only through the environment, the example uses only inputs that exist. `test/e2e/action-script.test.ts` runs the action's own "Run ShipCheck" script exactly as written against the fixture: exit codes 0, 1 and 2, outputs, report, run summary, hostile input values (quotes, `$( )`, backticks, `;`) run nothing, the password appears nowhere. Deliberate breakages, each failing a test: an input pasted into the script; ShipCheck's exit code not caught; the step always green; an input evaluated by the shell; the password passed as an argument. The versions of the three GitHub actions used (`checkout`, `setup-node`, `upload-artifact`, all v7) were read from their repositories.

**Not verified:** anything that only GitHub can run — the composite steps as a whole (Node set-up, build inside the action's folder, Chromium install, artifact upload), and the self-test workflow itself. The example's `@v0` tag does not exist before M10.

**Also in this stretch (M7 leftovers):** the terminal-versus-report test now also compares the grouped rows (basic security, flows on a phone); `--headed` was run once by me against the fixture (it ran through; a browser window showed briefly).

---

## Needed from the owner for later milestones

| When | What                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| M8   | Optional `GEMINI_API_KEY` repo secret for the manual AI run in CI.                                                            |
| M9   | One or two real apps the owner owns or may test, for sample reports. Confirmation of the LICENSE line "© 2026 Anjali Panwar". |
| M10  | Owner runs `npm login` and `npm publish`. Check beforehand that the `@anjalipanwar` npm scope belongs to the owner.           |
