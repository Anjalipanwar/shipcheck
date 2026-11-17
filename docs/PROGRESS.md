# ShipCheck — Progress log

Updated at the end of every milestone. Read this at the start of every session.

- **Plan:** `docs/BUILD_PLAN.md` · **Spec and full decisions log:** `docs/SPEC.md` §13
- **Last updated:** 2026-11-17, 0.1.1 prepared (audit fixes) and pushed, not published
- **Next up:** the owner's answers in "0.1.1 — Audit fixes" → "Open, with the owner" (push, one real-key run, publish). Still open from M10: the GitHub release for `v0.1.0`, the timed quickstart, the "About" box, the demo GIF; later release: a real-app sample report.

## Overview

| Milestone                                            | Status                  | Commit                           | Pushed                                                      |
| ---------------------------------------------------- | ----------------------- | -------------------------------- | ----------------------------------------------------------- |
| M0 — Scaffold                                        | done                    | `b59adfc`                        | yes                                                         |
| M1 — Fixture app with planted bugs                   | done                    | `2d605ba`                        | yes                                                         |
| M2 — Browser session, evidence, deterministic checks | done                    | `6498102`                        | yes                                                         |
| M3 — Report renderer and verdict                     | done                    | `8e0b406`                        | yes                                                         |
| M4 — AI flows with Stagehand + safety guard          | done                    | `f5f7e63`                        | yes                                                         |
| M5 — Mobile pass                                     | done                    | `f168b9e`                        | yes                                                         |
| M6 — AI judge, fix prompts, dedupe                   | done                    | `c2c651a` … `6403dbc`            | up to `fc928dc` yes; later commits no                       |
| M7 — CLI polish                                      | done                    | `951404c`, `bcec284` + follow-up | `bcec284` yes (CI green, about 5 min per job); follow-up no |
| M8 — GitHub Action                                   | done                    | `8727d73`, `e28acdf` + follow-up | `e28acdf` yes (CI and self-test green); follow-up no        |
| M9 — Docs and launch assets                          | done                    | see M9 section                   | see M9 section                                              |
| M10 — Release                                        | done                    | `38c5fec`                        | yes, with tags `v0.1.0`, `v0`                               |
| 0.1.1 — Audit fixes                                  | prepared, not published | `582adbf` … `18af27a`            | yes (by the owner)                                          |

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

**Not verified by a test, but by the owner by hand on a Mac (2026-11-15):** `--headed` shows the browser; the report opens by itself at the end.

**Decided on the way (SPEC §13, 2026-11-15 M7):** `password` and `yes` are refused in the settings file; an app that does not open is exit code 1 (a Blocker), not 2.

**Owner's answers (2026-11-15):** push the five commits and report CI time (done: green, 5 min 02 s and 5 min 10 s per job, browser tests about 4.5 minutes — under the 10 minutes above which the tests were to be split, so no split). Refusing `password` and `yes` in the settings file: approved. A dead app = exit code 1: approved. Terminal and report must always agree — fixed and tested (SPEC §13): "Hidden errors… not checked (your app did not open)" instead of "✓"; `test/e2e/progress-agrees.test.ts` compares progress lines and the coverage table in seven situations (found only this one disagreement). Then M8.

**For the owner's hand test of `--headed` and the report opening by itself** (not covered by any automated test): `npm run fixture` starts the pretend app at http://127.0.0.1:4173 (new helper `test/helpers/serve-fixture.ts`); in a second terminal `npm run build && node dist/cli.js http://127.0.0.1:4173 --no-ai --headed`. Result: waiting for the owner.

## M8 — GitHub Action

- **Status:** done — the action runs green in this repo's CI (2026-11-15)
- **Commit:** `8727d73`, plus a follow-up commit (report uploaded before the job is failed; the caller's package cache and `NODE_ENV` left alone; the package built once for all browser tests)
- **Pushed:** `2ae567d`, `8727d73`, `e28acdf` pushed on the owner's request. **No fix-up was needed:** both workflows were green at the first push. Action self-test: 1 min 00 s (lenient run 28 s including the build and Chromium, strict run 6 s, no-key run 4 s); three checks as designed — green with `fail-on: none`, failed with exit code 1 on a Blocker, exit code 2 without a key. Two report artifacts were uploaded (`shipcheck-report-lenient`, `shipcheck-report-strict`), none for the run that could not start. CI: 6 min 52 s (Node 22) and 6 min 39 s (Node 24), browser tests just under 6 minutes — up from about 5 because of the M7/M8 command tests, still under the 10 minutes above which the owner wants them split.

**Owner's answers (2026-11-15):** hand test on the owner's Mac — browser window visible with `--headed`: yes; report opened by itself at the end: yes. M10 checklist gets: switch the example workflow and README from `@main` to `@v0` once the tag exists, and test the example against the tag (added to `docs/BUILD_PLAN.md`; the example now says `@main`). For M9's real-app sample report the owner provides a second app they own; ask for the URL then.

**What was built**

1. **`action.yml`** (composite): sets up Node 22, builds ShipCheck from the action's own files, installs Chromium, runs the check, uploads the report folder as an artifact (also when problems were found), sets outputs `verdict`, `exit-code`, `report-dir`. Inputs: `url`, `gemini-api-key`, `email`, `password` (SPEC §5.2) plus one for every other setting of the command, the two other AI keys and `artifact-name`. Decisions in SPEC §13 (2026-11-15 M8).
2. **Run summary:** the command itself now adds the short report (verdict, coverage, issue table) to GitHub's run summary whenever `GITHUB_STEP_SUMMARY` is set (`src/step-summary.ts`). A summary file that cannot be written does not fail the run.
3. **`examples/github-workflow.yml`:** the file users copy — started by hand, push trigger ready to switch on, secrets from repository secrets, four numbered steps in plain words.
4. **`.github/workflows/action-selftest.yml`:** starts the pretend app (`npm run fixture`) and runs the action from this repository three times, automatic checks only, no key: lenient (`fail-on: none` → green, report files and outputs checked), strict (a Blocker must fail the step with exit code 1, report still written), and without a key (exit code 2, nothing written).

**How it was verified (locally — GitHub Actions cannot run on a laptop):** typecheck and lint clean, 573 unit tests and 179 real-browser tests pass. `test/unit/action.test.ts` reads the action and workflow files: spec inputs present, an input for every flag of the command, nothing from the workflow pasted into a script, secrets only through the environment, the example uses only inputs that exist. `test/e2e/action-script.test.ts` runs the action's own "Run ShipCheck" script exactly as written against the fixture: exit codes 0, 1 and 2, outputs, report, run summary, hostile input values (quotes, `$( )`, backticks, `;`) run nothing, the password appears nowhere. Deliberate breakages, each failing a test: an input pasted into the script; ShipCheck's exit code not caught; the job always green; an input evaluated by the shell; the password passed as an argument. The versions of the three GitHub actions used (`checkout`, `setup-node`, `upload-artifact`, all v7) were read from their repositories.

**Not verified:** the action used from another repository (`uses: Anjalipanwar/shipcheck@main`) — the self-test uses it from this repository (`uses: ./`); a full check with a real key inside GitHub Actions; the look of the run summary page (its text is tested, the page was not opened).

**Also in this stretch (M7 leftovers):** the terminal-versus-report test now also compares the grouped rows (basic security, flows on a phone); `--headed` was run once by me against the fixture (it ran through; a browser window showed briefly).

## M9 — Docs and launch assets

- **Status:** done (the real-app sample report is moved to a later release by the owner)
- **Commits:** `408200c` (missing-browser message, fixture names), `9b76c8c` (M9), and the commit after it named "docs: full-check sample report, …" (owner's decisions applied)
- **Pushed:** all yes (`dd2e9c1` is the commit with the owner's decisions) — CI green for `9b76c8c`: Node 22 in 6 min 44 s, Node 24 in 6 min 29 s, Action self-test in 58 s

**What was built**

1. **README** (written from what the code does today): what ShipCheck is, quickstart in three steps, "Get a free AI key" and "Add a test account" (the two sections reports point to), what it checks, options, settings file, exit codes, GitHub Action, what it will never do, limits, privacy and cost, questions, running from source. A note at the top says the package is not on npm before M10.
2. **`LICENSE`** (MIT, © 2026 Anjali Panwar — name to be confirmed), **`CONTRIBUTING.md`**, **`SECURITY.md`** (GitHub's private reporting, no email address), **`CHANGELOG.md`**, three issue templates (false alarm, bug or miss, idea), and `repository` / `homepage` / `bugs` in `package.json`.
3. **Sample report** `examples/reports/buggy-app.md` and `.html`, made by `npm run sample` from the fixture with automatic checks only. Checked: the fake secret key is masked, no path of this computer, no email address.
4. **First run without the test browser:** instead of "unexpected problem", a plain message with the one install command, naming the exact version ShipCheck was built with; exit code 2 (`src/browser/missing-browser.ts`).
5. **Tests for "every command and link shown in a report must work"** (`test/unit/docs.test.ts`, 14 tests): the report's "How to get a free AI key" link leads to a README section that exists (anchor computed the way GitHub does) and says how; "Add a test account (see the README)" has its section with both ways; every link in README, CONTRIBUTING, SECURITY and CHANGELOG leads somewhere; every flag named in the advice texts, in every message of the flows and the runner, and in the README exists in the command; the README's options table lists every flag; its settings-file example is accepted; its Action example matches `examples/github-workflow.yml`; the sample report exists and shows no secret.
6. **Project page and demo GIF:** `docs-site/index.html` plus the sample report, and step-by-step notes for the owner in `docs/notes/launch-assets.md`. Nothing is published.
7. **Fixture clean-up:** two recipe names in `/planner.html`, its test and SPEC §13 had been copied from the screen of the owner's app; replaced by made-up ones. They are still in the pushed history (`6403dbc`, `a10f0fb`).

**How it was verified:** typecheck and lint clean, 588 unit tests and 181 real-browser tests pass. Deliberate breakages, each failing a test: the "Get a free AI key" heading renamed; the test-account section renamed; an advice text naming a flag that does not exist; the README naming a flag that does not exist. The missing-browser message is tested by running the command with an empty browser folder.

**Not verified:** the plan's own condition — "a non-technical person could follow the README quickstart in under 5 minutes" — needs a person; the `npx` command in the README cannot work before M10; how the issue templates and the project page look on GitHub.

**Owner's decisions (2026-11-16)**

1. **Real-app sample report: not in this release.** The second app is still being worked on. M9 is finished without it; a real-app sample comes in a later release, and the owner decides about publishing consent then. Until then the earlier rule stands: nothing about the owner's real apps goes into the repository.
2. **One real-key run on the fixture: approved and done** (29 AI calls of 150, 1 min 47 s, verdict "Not ready": 2 Blockers, 4 Major, 7 Minor, 1 Info). Result: `examples/reports/buggy-app-full.md` and `.html`, made by `npm run sample -- --full`. The README links both samples (full check first). Checked in both files (`.md` and `.html`): the AI key from `.env` is not in them, no path of this computer, the fake secret key masked, nothing of the shape of ShipCheck's generated sign-up password (`Sc-…-…!9a`), no "typed “…”" line; the list of single steps with typed values exists only in `report.json`, which is not part of the sample. By test for every sample file: no key of Google's shape, no home path, no unmasked secret key.
3. **Licence name** "Anjali Panwar": confirmed.
4. **Security reports:** `SECURITY.md` now says "I aim to reply within 7 days." Private vulnerability reporting on GitHub: switched on by the owner (2026-11-16).
5. **Project page:** published with GitHub Pages as part of M10. **Demo GIF:** the owner records it after M10 with `docs/notes/launch-assets.md`; the README gets it then.
6. **Pushed history:** stays as it is, no force-push. The recipe names are harmless and the meal-planner theme of the fixture page is fine.
7. **Quickstart timing:** the owner times it after M10 with the real `npx` command. On the M10 checklist.
8. **npm:** the owner has an account, user name `anjalipanwar`, logged in on this Mac.

**Also changed with these decisions:** the Markdown versions of both samples start with a note that they are samples and that the screenshots are shown in the HTML version (the sample folder holds only the two report files); the project page links both samples; `test/unit/docs.test.ts` has 16 tests (new: both samples linked from the README and labelled with their kind of check, the full one made by a real AI model; no AI key in any sample).

---

## M10 — Release

- **Status:** done — `@anjalipanwar/shipcheck@0.1.0` is on npm (published by the owner), tags `v0.1.0` and `v0` point to `38c5fec`, project page live at https://anjalipanwar.github.io/shipcheck/
- **Commit:** `38c5fec` (the release), plus the docs commit after it that records this result
- **Pushed:** `38c5fec` and both tags yes; the docs commit after it — to be asked

**What was done**

1. **The package was tested the way a user gets it.** `npm pack` (7 files, 242 kB: `dist/`, README, LICENSE, `package.json`), installed into an empty folder with an empty npm cache, then from there: `--version` → 0.1.0; `--help`; a run with automatic checks on the fixture → exit code 1, verdict "Automatic checks found issues" (1 Blocker, 1 Major, 6 Minor, 1 Info), report with screenshots written; without a key → exit code 2 with the how-to.
2. **Found by that test:** a fresh install gets the newest matching browser driver (Playwright 1.65.1, this repository has 1.65.0), whose browser was not on this Mac. ShipCheck showed the plain "test browser is not installed" message with `npx playwright@1.65.1 install chromium` — the right version, read at run time. After that command the run worked. So the README's sentence about the very first run is what really happens.
3. **Package settings:** `prepack` builds before every pack/publish (a stale `dist/` cannot be published); `publishConfig.access: public`; two dependencies that no code used (`ora`, `picocolors`) removed. Checked: no path of this computer in `dist/` (also not in the source maps), every module the build imports is a declared dependency, the version is read from `package.json` at run time.
4. **README for the released state:** the "Before the first release" note is gone; the Action example says `@v0`. `examples/github-workflow.yml` and its test say `@v0` too. **CHANGELOG:** entries are under `0.1.0`, dated 2026-11-16.
5. **`.github/workflows/pages.yml`:** publishes `docs-site/` with GitHub's own Pages actions (versions and permissions taken from their READMEs: `upload-pages-artifact@v5`, `deploy-pages@v5`). Runs when `docs-site/` changes on `main`.
6. **`.github/workflows/release-check.yml`:** runs when the `v0` tag is set or moved; calls `Anjalipanwar/shipcheck@v0` like a user would, against the fixture, automatic checks only, and checks exit code, report and that the planted secret key was found. This is the "test the example against the tag" from the checklist.

**How it was verified:** typecheck and lint clean, 591 unit tests and 181 real-browser tests pass; the clean-install test above was repeated after the last change to the dependencies.

**Not verified yet:** the full check (with an AI key) from the installed package — no real-key run was made; the owner's timed quickstart covers it. The two new workflows have not run on GitHub yet. `npx @anjalipanwar/shipcheck` itself, which exists only after the publish.

**After the push and the publish (2026-11-16)**

1. **CI for `38c5fec`:** green — CI 7 min 33 s, Action self-test 1 min 31 s, Project page 24 s.
2. **Project page:** https://anjalipanwar.github.io/shipcheck/ answers, both sample reports open from it, the full sample served there is identical to the file in the repository (checked by fetching, not by eye).
3. **Publish, first attempt:** npm showed only a placeholder version `0.0.0-stage` ("awaiting a staged release") and no 0.1.0; `npx` failed with "could not determine executable to run". No tag was set. This is npm's staged publishing: the real version appears only after the owner's approval. Lesson for the next release: after `npm publish`, check `npm view @anjalipanwar/shipcheck versions` before anything else.
4. **Publish, checked:** 0.1.0 is `latest` (7 files). From an empty folder with an empty npm cache, with the real command: `npx @anjalipanwar/shipcheck --help` works (this is the plan's "done when"), `--version` → 0.1.0, automatic checks on the fixture → exit code 1, the expected verdict (1 Blocker, 1 Major, 6 Minor, 1 Info) and a report with screenshots, no key → exit code 2. The published `dist/cli.js` and `dist/main-*.js` are byte-identical to a build of `38c5fec`; the published README says `@v0` and has no pre-release note.
5. **Tags:** `v0.1.0` and `v0` set on `38c5fec` only after that check, and pushed.
6. **Release check (the example against the tag):** green in 49 s — `Anjalipanwar/shipcheck@v0` ran against the fixture, found the planted secret key, and attached the `shipcheck-report` artifact.

**Seen, not changed:** on the first `npx` run npm prints two warnings of its own ("ERESOLVE overriding peer dependency", a deprecated sub-package). They come from dependencies of the AI browser library and do not affect the run.

**Not verified:** the full check with an AI key from the published package (no real-key run was made) — covered by the owner's timed quickstart.

**Open, with the owner**

1. GitHub release for `v0.1.0`: created by the owner on GitHub with the 0.1.0 section of `CHANGELOG.md` (no access from here).
2. Time the README quickstart with the real `npx` command (target: under 5 minutes) — M9's "done when".
3. Put the project page's address into the repository's "About" box.
4. Record the demo GIF (`docs/notes/launch-assets.md`); the README gets it then.
5. Later release: a real-app sample report. Until then nothing about the owner's real apps goes into the repository.

---

## 0.1.1 — Audit fixes (2026-11-17)

- **Status:** prepared, stopped before `npm publish` (owner's instruction). Version 0.1.1, CHANGELOG written, package packed and checked from an empty folder.
- **Commits (all on `main`, none pushed):** `582adbf` A-01 redirects · `a0e1ac5` A-02/A-12 passwords in every spelling · `9cefbb3` A-03 everyday-word passwords · `717d9e8` A-06 report folder · `8c5ffcc` A-05 guard · `2d9e577` A-16 README note · `f7b1229` A-04 hard time limit · `3a50704` A-08 npm audit fix · `7935c5a` release: version, CHANGELOG, audit with status · `18af27a` docs: what the dependency fix reaches, PROGRESS. The owner re-stamped all of them with the GitHub noreply address before pushing, which changed their ids; the ids here are the new ones.
- **Pushed:** yes, by the owner (2026-11-17), up to `18af27a`; the hash-fix docs commit after it — see below.

**Owner's decisions (2026-11-17, on `docs/AUDIT-v0.1.0.md`)**

1. Release 0.1.1 before announcing, with A-01 (server redirects caught by the domain lock; an off-site page never reported as "Home page opens"), A-02, A-03, A-04 (`--max-minutes` a hard stop that still writes a partial report), A-06, A-16, and the guard gaps ("Send", "Log out", icon-only delete buttons blocked; the button's accessible name and icon labels read by the guard).
2. Strengthen the end-to-end password test so that removing the final scrubbing step makes it fail (A-12).
3. npm audit: apply the available fix if it is compatible with Stagehand 3.7.x and all tests pass; otherwise record why in the audit and defer to v0.2.
4. Process for every fix: failing test first (reproducing the audit's evidence), then the fix, then a deliberate break to prove the test catches it. Small commits.
5. Explain the 9 unpushed leftover commits; delete nothing until the owner says so.
6. Afterwards: a "Status" column in the audit, checked for details of the owner's real apps, committed; CHANGELOG for 0.1.1; prepare the release like 0.1.0 and stop before `npm publish`; record everything here.

**What was done, and how each fix was proven** (details in each commit message; builder's calls in SPEC §13, 2026-11-17)

| Finding                      | Test that failed first                                                                                                                                            | Deliberate break → caught by                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 redirects               | 5 browser tests (typed address, clicked link, POST 303, two-hop chain, the other site contacted); a command test for an app address that forwards elsewhere       | redirect check removed → 5 tests; forwarding stop removed → 1 command test                                                                                                                                                                                                                    |
| A-02, A-12 passwords         | an end-to-end test with a fixture page (`/get-login.html`) that repeats the password in its address and its message; unit tests per spelling                      | replacement loop removed → e2e test + 8 unit tests; whole-report scrubbing removed → e2e test; only the typed spelling protected → 3 unit tests; password parameters not hidden → 1 unit test                                                                                                 |
| A-03 everyday-word passwords | unit tests; command runs with `--password test/mobile/check/desktop/verified`                                                                                     | fixed values scrubbed again → 2 command + 4 unit tests; whole-word rule removed → 1 unit test                                                                                                                                                                                                 |
| A-04 time limit              | the real command on `/busy.html` (endless script) with `--max-minutes 1`: hung until killed at 180 s                                                              | timer removed → the same 180-second hang, test fails                                                                                                                                                                                                                                          |
| A-05 guard                   | 39 unit tests and 9 real-browser tests (Lucide/Font Awesome icons, svg title, sprite, data-testid, chat box, email composer, contact form, unlabeled menu button) | ids not judged; icons not judged; plain Send always allowed; log-out wording removed; nameless buttons allowed; inner labels not read; menu buttons not recognised — each fails tests (two breaks first did not apply because of formatting; redone and checked that the file really changed) |
| A-06 report folder           | command tests for a read-only folder and a file in the way                                                                                                        | check removed → 2 command tests; clean-up removed → 1 command + 1 unit test                                                                                                                                                                                                                   |

- **A-08, npm audit:** `npm audit fix` (no `--force`) moved Stagehand's AI-SDK packages to older versions inside Stagehand 3.7.3's own ranges → 0 vulnerabilities in the lock file; all tests pass; Stagehand starts over CDP and closes with a placeholder key. **Found in the release check:** this reaches the repository, CI and the GitHub Action (it installs with `npm ci`), but not `npx`/`npm install` users — npm ignores a package's lock file, and a published `npm-shrinkwrap.json` did not help either (tested with npm 11.19.1: the user install still got `ai` 5.0.290 with `undici`/`@fastify/busboy`). Recorded in the audit and deferred to v0.2 (owner's rule). By reading the installed code: the vulnerable part only parses multipart form answers, which the AI library never asks for.
- **A-16:** both warnings come from inside Stagehand 3.7.3; npm reads `overrides` only from the root project, so they cannot be silenced for `npx` users. README note added. The release check showed a third notice with npm 11.19.1 (install scripts it did not run: `@google/genai`, `bufferutil`, `protobufjs`); the note covers it, and the runs below show ShipCheck works without those scripts. Issue #1 stays open for v0.2.
- **Audit document:** committed with a "Status" column (Fixed in 0.1.1 / Deferred / Won't fix) and a status note at the top. Checked for real-app details: only hosting-platform names (finding A-18), local test addresses, `example.com` and the project's own public links. The machine-name author address quoted in A-23 is now described instead of repeated.
- **Also changed:** an old test expected a 60 ms limit to still open the home page; with a hard stop it now expects "the time limit was reached before the home page had finished loading" everywhere and no Blocker. "1 minutes" is now "1 minute".

**How it was verified:** typecheck and lint clean; 663 unit tests and 211 real-browser tests pass (one earlier full run showed 9 failures with test times of 760–3,480 s — the computer had slept; the rerun passed). Release check exactly like 0.1.0: `npm pack` → 7 files, 256.5 kB, no path of this computer in `dist/`; installed into an empty folder with an empty npm cache; from there: `--version` → 0.1.1, `--help`, no key → exit 2 with the how-to, automatic checks on the fixture → exit 1 with the same counts as 0.1.0 (1 Blocker, 1 Major, 6 Minor, 1 Info) and a report with screenshots; and the fixes: an address that forwards to another site → exit 2, plain message, no report, the other site received nothing; `--password test` → full report; `/busy.html` with `--max-minutes 1` → stopped after 61 s with a partial report; `--out` pointing at a file → exit 2 with a plain message.

**Not verified:** a real model call with the changed AI-SDK packages (needs a real key and the owner's approval; `npm run test:ai` on the fixture would cover it). CI on GitHub (needs a push). The published package (after the owner's `npm publish`).

**Seen, not changed:** a run stopped by the time limit exits with the code its findings give — for the busy page that is 0, although almost nothing was tested. Every partial run has worked this way since 0.1.0 (exit codes follow `--fail-on`); the report and the summary say "partial". Worth a decision for v0.2.

**The 9 unpushed leftover commits (explained to the owner; nothing deleted)**

They are "dangling" commit objects: stored only in this computer's `.git` folder, reachable from no branch or tag, and never pushed (GitHub only receives commits a branch or tag points to). 3 are dropped `git stash` entries ("WIP on main…": `6f781be`, `9612f7f`, `6a4306d`). 6 are older versions of commits that were later replaced with `--amend` or by rebasing onto the GitHub commit: `74f8c90` (→ `38c5fec`), `0bfa54f` and `68e2eb6` (→ `dd2e9c1`), `9ccb5e8` (→ `9b76c8c`), `688ceaa` (→ `2d605ba`), `d0b60ee` (→ the amended log-in commit). None contains a key, and no address or email beyond what is already in the pushed history. They are harmless, and git removes them by itself (`git gc`, after the reflog and prune periods). Deleting them now would be `git reflog expire --expire-unreachable=now --all && git gc --prune=now` — only if the owner says so.

**Open, with the owner**

1. Push the 0.1.1 commits to `main` (and then watch CI)? A push may be refused by GitHub's email privacy setting, as before.
2. Approve one real-key run on the fixture (`npm run test:ai`) to check the changed AI-SDK packages with a real model before publishing?
3. Publish: `npm publish` from a clean checkout of the release commit (`prepack` builds), then `npm view @anjalipanwar/shipcheck versions` first (staged publishing), then the empty-folder check with the real `npx` command, then set `v0.1.1` and move `v0`, and watch the "Release check" run.
4. GitHub release for `v0.1.1` with the CHANGELOG section (owner's step).
5. Deferred items for v0.2 are listed in the audit's Status column (among them: A-08 for `npx` users, removing the npm warnings, the backstop part of A-05, A-07, A-09, A-10, A-11).

---

## Needed from the owner for later milestones

| When  | What                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| M8    | Optional `GEMINI_API_KEY` repo secret for the manual AI run in CI.                                                  |
| Later | A real app the owner owns, for a real-app sample report (moved out of M9 by the owner on 2026-11-16).               |
| M10   | Owner runs `npm publish` (logged in as `anjalipanwar`). Switch on GitHub Pages and private vulnerability reporting. |
