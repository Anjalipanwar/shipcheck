# ShipCheck — guide for Claude Code

ShipCheck is an open-source CLI + GitHub Action: an AI agent uses a vibe-coded web app like a real first-time user and produces a plain-English HTML QA report with evidence and fix prompts.

- **Spec (source of truth):** `docs/SPEC.md`
- **Build plan (milestones + acceptance criteria):** `docs/BUILD_PLAN.md`
- **Owner:** Anjali Panwar — 10+ years QA automation engineer. Expect and welcome QA-grade rigor. Explain decisions in plain language.

## How to work
- At the start of every session, read `docs/PROGRESS.md`. Keep it updated at the end of every milestone (status, commit hash, pushed yes/no, owner decisions and feedback, open questions).
- Work one milestone at a time from `docs/BUILD_PLAN.md`. Stop after each milestone, report status (what's done, how you verified it, anything off-spec), and wait for "go" unless told to continue.
- Before using any third-party API (especially Stagehand, Playwright, AI SDKs), check current official docs/README or the installed package's types. Never invent APIs from memory.
- Write tests alongside code. A milestone is not done until `npm run typecheck && npm run lint && npm test` pass.
- Verify claims with evidence: run the thing, show output or a screenshot. Don't say "should work".
- Commit at the end of each milestone with Conventional Commits. Don't push or publish unless the owner asks.
- If the spec is ambiguous or wrong, pick the safest reasonable option, note it in the "Decisions log" in `docs/SPEC.md`, and tell the owner.

## Non-negotiables (from SPEC §7)
- Domain lock, no payments, no destructive/outward actions, budgets, no attack payloads, no secrets written anywhere, ownership confirmation.
- No finding without evidence. Report language is for non-technical users.
- Keep the maintainer cost at €0: no hosted services, no required paid APIs; users bring their own AI key.

## Conventions
- TypeScript strict, ESM, Node ≥ 22.12 (checked at startup by `src/node-version.ts`). Small modules per SPEC §8 layout. zod for all external input.
- All LLM prompts live in `src/ai/prompts.ts`. All model defaults in `src/ai/models.ts`.
- Testing against real third-party websites is not allowed in automated tests — use `test/fixtures/buggy-app`.
