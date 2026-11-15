# ShipCheck — Progress log

Updated at the end of every milestone. Read this at the start of every session.

- **Plan:** `docs/BUILD_PLAN.md` · **Spec and full decisions log:** `docs/SPEC.md` §13
- **Last updated:** 2026-11-15, M5 follow-ups pushed
- **Next up:** real-app run (`--no-ai` and AI) and a short summary for the owner, once the owner sends the app's address. **Do not start M6** until the owner says "go" (owner, 2026-11-15).

## Overview

| Milestone                                            | Status      | Commit    | Pushed |
| ---------------------------------------------------- | ----------- | --------- | ------ |
| M0 — Scaffold                                        | done        | `b59adfc` | yes    |
| M1 — Fixture app with planted bugs                   | done        | `2d605ba` | yes    |
| M2 — Browser session, evidence, deterministic checks | done        | `6498102` | yes    |
| M3 — Report renderer and verdict                     | done        | `8e0b406` | yes    |
| M4 — AI flows with Stagehand + safety guard          | done        | `f5f7e63` | yes    |
| M5 — Mobile pass                                     | done        | `f168b9e` | yes    |
| M6 — AI judge, fix prompts, dedupe                   | not started | —         | —      |
| M7 — CLI polish                                      | not started | —         | —      |
| M8 — GitHub Action                                   | not started | —         | —      |
| M9 — Docs and launch assets                          | not started | —         | —      |
| M10 — Release                                        | not started | —         | —      |

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
- **Commit:** see the next progress-log commit
- **Pushed:** no — waiting for the owner's answer

**What was built:** the menu check runs on the start page and every page the phone pass opens (up to 5 more). Each menu gets a fingerprint — its button's label plus the link paths in its header (and in the panel it opens) — and each distinct menu is tapped once. A broken menu away from the start page says where: "The menu on /shop does not open on a phone".

**How it was verified:** typecheck, lint, 446 unit tests, 114 real-browser tests pass. New full `--no-ai` run on a 5-page local site: one broken menu shared by 3 pages (one with the current page highlighted) → one finding and one tap; a second broken menu on `/shop` → its own finding naming `/shop`; a working menu on `/help` → "The menu opens on a phone"; exactly 3 taps in the action log. Switching the de-duplication off on purpose made the test fail. Bug #12: the dedicated test still starts on `/menu-broken.html`; the default run from `/` still never reaches it, and its finding list is unchanged.

---

## Needed from the owner for later milestones

| When | What                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| M8   | Optional `GEMINI_API_KEY` repo secret for the manual AI run in CI.                                                            |
| M9   | One or two real apps the owner owns or may test, for sample reports. Confirmation of the LICENSE line "© 2026 Anjali Panwar". |
| M10  | Owner runs `npm login` and `npm publish`. Check beforehand that the `@anjalipanwar` npm scope belongs to the owner.           |
