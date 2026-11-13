# Stagehand notes (verified 2026-11-13)

Checked against the npm registry, the package README and the type definitions shipped in the installed package (`node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/`), plus a live smoke run. Nothing here is from memory.

- **Version:** `@browserbasehq/stagehand@3.7.3`, pinned exactly (npm dist-tag `v3-latest`, published 2026-08-28). Needs Node `^20.19.0 || >=22.12.0`.
- **Why not `latest` (4.4.0):** v4 is a rewrite that runs as a Chrome extension. It has no Playwright integration, no request routing and no `agent()`, needs Node ≥ 22.18 and a system Chrome install. SPEC §7/§8 depend on Playwright, so we stay on v3. Risk: v3 has had no release since August 2026; re-evaluate v4 for v0.2.
- **Init with a local browser (no Browserbase account):** `const sh = new Stagehand({ env: 'LOCAL', localBrowserLaunchOptions: { headless, executablePath: chromium.executablePath(), viewport, hasTouch, deviceScaleFactor, args }, model, verbose: 0, disablePino: true }); await sh.init();` then `sh.context.pages()[0]`. Close with `await sh.close()`.
- **Sharing the browser with Playwright:** `chromium.connectOverCDP(sh.connectURL())` attaches Playwright to the same browser (smoke-tested: both saw the same page). `act`/`observe`/`extract`/agent `execute` accept `{ page }` with a Playwright page.
- **Model + key:** `model: 'google/<model-id>'` (also `anthropic/…`, `openai/…`) or `model: { modelName, apiKey }`. Per-call override via `{ model }` in options.
- **Env names Stagehand reads itself:** Google → `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` (first one set wins); Anthropic → `ANTHROPIC_API_KEY`; OpenAI → `OPENAI_API_KEY`. These match SPEC §8, so no mapping is needed. We will still pass `apiKey` explicitly so our own detection decides.
- **`act`:** `act(instruction: string, options?)` or `act(action: Action, options?)` → `{ success, message, actionDescription, actions }`. Options: `model`, `variables`, `timeout`, `page`.
- **`observe`:** `observe(instruction?, options?)` → `Action[]`, each `{ selector, description, method?, arguments? }`. Options add `selector`, `ignoreSelectors`.
- **`extract`:** `extract(instruction, zodSchema, options?)` → data typed by the schema; `extract(instruction)` → `{ extraction: string }`; `extract()` → `{ pageText }`.
- **`agent`:** `sh.agent({ systemPrompt?, model?, mode?, tools? }).execute(instruction | { instruction, maxSteps?, page?, signal? })` → `{ success, message, actions, completed, usage? }`. We plan not to use it for flows: its clicks happen inside Stagehand where our safety guard cannot veto them. Flows will use `observe()` → guard → `act(action)`.
- **Usage counters:** `await sh.metrics` gives token totals per act/extract/observe; `await sh.history` lists calls. We count LLM calls ourselves for the 150-call budget.
- **zod:** peer range `^3.25.76 || ^4.2.0`; we use zod 4.
