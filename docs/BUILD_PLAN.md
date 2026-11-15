# ShipCheck v0.1 — Build Plan

Read `docs/SPEC.md` first. Build milestone by milestone, in order. Each milestone ends with:
all its acceptance criteria met → `npm run typecheck && npm run lint && npm test` green → a commit (Conventional Commits, e.g. `feat(checks): add secret scanner`) → a 3–5 line status note to the owner. **Then stop and wait for the owner's "go"** before the next milestone, unless the owner said to continue automatically.

Estimated total: ~2 focused days. Times are rough guides, not limits.

---

## M0 — Scaffold (≈1h)
- `package.json` (name `@anjalipanwar/shipcheck`, type module, `bin.shipcheck`, engines node ≥ 20), TypeScript strict, tsup, vitest, eslint + prettier, `.gitignore`, `.nvmrc` (20).
- Scripts: `build`, `dev` (run CLI from source with tsx), `typecheck`, `lint`, `format`, `test`, `test:e2e`.
- Install `playwright` + Chromium, `@browserbasehq/stagehand`, `commander`, `zod`, `@axe-core/playwright`, terminal UX libs.
- **Verify Stagehand's current API and model/env config from its official docs/README now**, and write a 10-line note in `docs/notes/stagehand.md` (version, how to init with local browser, how to set model + key, act/observe/extract/agent signatures). Do not guess APIs.
- `.github/workflows/ci.yml`: install, typecheck, lint, unit tests.
- **Done when:** `npm run dev -- --help` prints the CLI help; CI file present; empty test passes.

## M1 — Fixture app with planted bugs (≈1h)
- `test/fixtures/buggy-app/` with the 10 planted bugs from SPEC §10, plus a tiny local server helper (random port, request hit counter for the "Delete account" endpoint and checkout submit).
- `test/fixtures/buggy-app/BUGS.md` listing each planted bug and the expected finding.
- **Done when:** the fixture serves locally in tests and a smoke test fetches its pages.

## M2 — Browser session, evidence and deterministic checks (≈3h)
- `browser/session.ts`: launch, desktop + mobile contexts, UA suffix, **domain lock** via request routing (unit-test the allow/deny logic).
- `browser/evidence.ts`: console + pageerror + failed request capture, screenshots (compressed), action log.
- `checks/`: errors, performance, https, headers, secrets (with JWT role decode + masking), seo (incl. raw-HTML empty-shell), links, a11y.
- Each check returns `Finding[]` per `report/schema.ts`.
- **Done when:** a `--no-ai` dev mode runs only deterministic checks against buggy-app and outputs `report.json` that contains bugs #3, #4, #5, #6 (sk_live flagged, pk_test NOT flagged). Unit tests cover true + false positives for every check.

## M3 — Report renderer and verdict (≈2h)
- `report/verdict.ts` (rules in SPEC §5.3) with unit tests.
- `report/html.ts`: self-contained HTML per SPEC §5.3 (sections, cards, copy buttons for fix prompts, screenshot lightbox, light/dark, mobile-friendly, accessible). `report/markdown.ts` for `report.md` and step summary.
- **Done when:** M2's `--no-ai` run produces a good-looking `report.html` (open it and screenshot it for the owner) under 5 MB; snapshot test for HTML structure.

## M4 — AI flows with Stagehand + safety guard (≈5h)
- `ai/models.ts`: provider/model auto-detection from env, `--model` override, friendly no-key message.
- `browser/guard.ts`: destructive-action and payment detection (EN + DE patterns), enforced in code before any click/fill the agent performs. Unit-test patterns.
- Flows: landing, signup, login, core, forms — each with step budget, screenshots, action log, structured observations (expected vs actual), graceful failure → "couldn't test" entries.
- Global budgets: `--max-minutes`, max LLM calls.
- **Done when:** with an AI key, a run on buggy-app detects bugs #2 and #7, never hits the delete counter (#9) or submits checkout (#10), and stays on-domain. Without a key, the CLI explains how to get one and exits 2.

## M5 — Mobile pass (≈1.5h)
- iPhone preset, re-run landing + login/core within budget, layout checks (overflow, offscreen/overlapping primary buttons, tap targets).
- **Done when:** buggy-app bugs #1 and #8 are detected on mobile and not reported on desktop.

## M6 — AI judge, fix prompts, dedupe (≈2h)
- `ai/prompts.ts` + `ai/judge.ts`: observations → Findings in plain English with severity per SPEC definitions and a fix prompt per finding. Enforce: no evidence → no finding. Dedupe near-duplicates. Keep jargon out (add a test that rejects findings containing words like "DOM", "selector", "stack trace" in `title`).
- **False-alarm fixture (owner decision 2026-11-15):** the real-app run reported two sign-up Blockers that were false alarms (the sign-up had worked; it was judged while the page was still loading, before the redirect). Build a fixture case that reproduces this — a sign-up that succeeds but shows a loading label first and redirects late, plus a tracking beacon (same-site POST answered 202) next to a form the page itself refuses — and a test that proves the M6 judge reports **no** finding for it.
- **Done when:** full AI run on buggy-app meets SPEC §10 targets (≥ 7/10 planted bugs, 0 guard violations, 0 false secret flags) and the report reads like a clear bug report.

## M7 — CLI polish (≈1h)
- Ownership confirmation, `--yes`, CI detection, live progress, summary print, auto-open report, exit codes, `--fail-on`, config file support, credentials via env, nothing secret written anywhere (add a test that greps the output dir for the test password).
- **Done when:** all flags in SPEC §5.1 work; `npm run build` + `node dist/cli.js <url>` works.

## M8 — GitHub Action (≈1.5h)
- `action.yml` (composite): setup Node, install Chromium, run ShipCheck, upload artifact, write step summary. Inputs per SPEC §5.2.
- `examples/github-workflow.yml`.
- A workflow in this repo that runs the action against the buggy-app (deterministic mode) to prove it works.
- **Done when:** the action runs green in this repo's CI.

## M9 — Docs and launch assets (≈2h)
- README per SPEC §11, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, issue templates.
- `examples/reports/buggy-app.html` + slots for 2 real-app reports (owner supplies apps they own/have permission for).
- GitHub Pages project page (simple static `docs-site/` or Pages from `examples/`), with the sample report and quickstart.
- Record a short demo GIF of a CLI run (or leave a clear TODO with exact steps for the owner).
- **Every command and link shown in a report must work (owner decision 2026-11-15).** Checklist: the README has the section the report links to (`#get-a-free-ai-key`) and explains test accounts ("Add a test account (see the README)"); every flag named in a report's advice (`--flows`, `--max-minutes`, `--goal`, `--email`/`--password`) exists. Add a test that reads `README.md` and fails if a heading the report links to is missing, and one that checks each flag named in `ADVICE` against the CLI's options.
- **Done when:** a non-technical person could follow the README quickstart in under 5 minutes.

## M10 — Release (≈1h, owner involved)
- `npm pack` dry run, check package contents/size. Owner runs `npm login` + `npm publish --access public`.
- Tag `v0.1.0` and move `v0` tag; GitHub release notes from CHANGELOG.
- Re-check the M9 list after publishing: the full-check command printed in reports (`npx @anjalipanwar/shipcheck <url>`) runs from a clean machine, and the report's links open.
- **Done when:** `npx @anjalipanwar/shipcheck --help` works from a clean machine.

---

## Cut list if time runs short (cut from the bottom first)
1. Demo GIF (leave instructions)
2. GitHub Pages page (README + sample report in repo is enough)
3. Accessibility check
4. Broken-link check
5. Forms flow down to 1 form

Never cut: safety guard, domain lock, budgets, evidence-per-finding, tests for deterministic checks.
