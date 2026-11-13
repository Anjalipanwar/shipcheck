# Kickoff prompt for Claude Code

Paste the text below into Claude Code, started inside this folder (`cd ~/shipcheck && claude`).

---

You're building ShipCheck v0.1 with me. Everything you need is in this repo:

1. Read `CLAUDE.md`, then `docs/SPEC.md` in full, then `docs/BUILD_PLAN.md`.
2. Before writing any code, reply with:
   - a 5-line summary of what we're building, in your own words,
   - anything in the spec that looks wrong, risky or ambiguous (max 5 points),
   - your confirmation of the Stagehand version you'll use and how you checked its current API.
3. Then start with milestone M0. Work through the milestones in order. After each milestone: run typecheck, lint and tests, commit, and give me a short status (done / how verified / anything off-spec). Wait for my "go" before starting the next one.

Rules: follow the safety requirements in SPEC §7 exactly, never test against real third-party sites in automated tests, and don't push to GitHub or publish to npm unless I ask.
