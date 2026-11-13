# ShipCheck — Progress log

Updated at the end of every milestone. Read this at the start of every session.

- **Plan:** `docs/BUILD_PLAN.md` · **Spec and full decisions log:** `docs/SPEC.md` §13
- **Last updated:** 2026-11-13, after M3
- **Next up:** M4 — AI flows with Stagehand + safety guard (waiting for the owner's "go", an AI key and the flow-design confirmation)

## Overview

| Milestone                                            | Status      | Commit    | Pushed |
| ---------------------------------------------------- | ----------- | --------- | ------ |
| M0 — Scaffold                                        | done        | `b59adfc` | yes    |
| M1 — Fixture app with planted bugs                   | done        | `2d605ba` | yes    |
| M2 — Browser session, evidence, deterministic checks | done        | `6498102` | yes    |
| M3 — Report renderer and verdict                     | done        | see log   | no     |
| M4 — AI flows with Stagehand + safety guard          | not started | —         | —      |
| M5 — Mobile pass                                     | not started | —         | —      |
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
- Follow SPEC §7 safety rules exactly; never test against real third-party sites in automated tests; do not publish to npm unless asked.

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
- No feedback yet on the builder's M2 choices listed below — they stand until the owner says otherwise.

**Builder's choices awaiting owner feedback** (details in `docs/SPEC.md` §13)

1. Playwright launches the browser and Stagehand attaches to it (reverses the M0 note).
2. The domain lock blocks top-level page navigations only; background requests and embedded frames to other sites are allowed.
3. Severities: uncaught error = Minor, broken internal link = Major, broken image = Minor. One dead link therefore changes the verdict to "Fix before launch".
4. Link checking never requests links that look like log out, delete, confirm or pay; only "not found" and server errors count as broken.
5. `Finding` has an extra `rule` field; checks also return "passed" and "not tested" lines.
6. `--no-ai` is a public flag; the ownership confirmation was implemented early.
7. Stripe test secret keys (`sk_test_`) are not flagged.

**Open questions**

- Is "broken internal link = Major" the right severity, or should it be Minor?
- The first CI run on GitHub (started by the push) has not been checked yet.
- Stagehand `act` / `observe` on Playwright-owned pages is untested until an AI key is available (M4). Reading pages (`extract`) is confirmed.

---

## M3 — Report renderer and verdict

- **Status:** done
- **Commit:** the `feat(report)` commit right after `b7f09f0` (see `git log`)
- **Pushed:** no — waiting for the owner's answer

**What was built:** `report.html` (one self-contained file: verdict banner, "Fix these first", issue cards with evidence and fix-prompt copy buttons, screenshot lightbox, light/dark, phone layout), `report.md`, the GitHub step-summary text (used in M8), shared wording in `report/present.ts`. A `--no-ai` run now writes all three files and the CLI prints the path of `report.html`. The verdict rules were already built and tested in M2; M3 added the "top 3" ranking.

**Result against buggy-app (`--no-ai`):** `report.html` is about 70 KB (limit 5 MB) with the same eight findings as M2. 273 unit tests and 45 real-browser tests pass. The browser tests open the real report and check: no errors, no network requests, copy button, lightbox, no serious accessibility problems (desktop and phone, light and dark), no sideways scroll on a phone, readable without JavaScript, no password or unmasked key in any file. Three deliberate breakages (wrong script hash, pale text, unwrapped long text) were each caught by these tests.

**Owner decisions and feedback**

- None yet for M3.

**Builder's choices awaiting owner feedback** (details in `docs/SPEC.md` §13)

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

## Needed from the owner for later milestones

| When | What                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4   | An AI key in the terminal environment (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) — never pasted into chat or a file. A paid key makes M4–M6 smoother than the free Gemini quota. |
| M4   | Confirmation of the flow design: `observe` → safety guard → `act`, instead of Stagehand's free-running `agent()`.                                                                                 |
| M8   | Optional `GEMINI_API_KEY` repo secret for the manual AI run in CI.                                                                                                                                |
| M9   | One or two real apps the owner owns or may test, for sample reports. Confirmation of the LICENSE line "© 2026 Anjali Panwar".                                                                     |
| M10  | Owner runs `npm login` and `npm publish`. Check beforehand that the `@anjalipanwar` npm scope belongs to the owner.                                                                               |
