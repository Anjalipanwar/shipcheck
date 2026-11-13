# Stagehand notes (verified 2026-11-13)

Checked against the npm registry, the package README and the type definitions shipped in the installed package (`node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/`), plus a live smoke run. Nothing here is from memory.

- **Version:** `@browserbasehq/stagehand@3.7.3`, pinned exactly (npm dist-tag `v3-latest`, published 2026-08-28). Needs Node `^20.19.0 || >=22.12.0`.
- **Why not `latest` (4.4.0):** v4 is a rewrite that runs as a Chrome extension. It has no Playwright integration, no request routing and no `agent()`, needs Node ≥ 22.18 and a system Chrome install. SPEC §7/§8 depend on Playwright, so we stay on v3. Risk: v3 has had no release since August 2026; re-evaluate v4 for v0.2.
- **How ShipCheck runs it (decided in M2 after experiments):** Playwright launches Chromium and owns the desktop and phone contexts, so the domain lock, evidence listeners and device emulation cover every page including popups. Stagehand then attaches to that same browser: launch Chromium with `--remote-debugging-port=<free port>`, read `webSocketDebuggerUrl` from `http://127.0.0.1:<port>/json/version`, and pass it as `new Stagehand({ env: 'LOCAL', localBrowserLaunchOptions: { cdpUrl: <ws url> }, model, verbose: 0, disablePino: true })` + `await sh.init()`. An `http://` cdpUrl fails with a 404; it must be the `ws://` URL. Verified without an AI key: `sh.extract({ page })` read Playwright pages from both the desktop and the phone context, and `sh.close()` left the Playwright browser running.
- **Why not let Stagehand launch the browser:** tried first. It works (`executablePath: chromium.executablePath()`, then `chromium.connectOverCDP(sh.connectURL())`), but everything then lives in one default context with no native phone emulation.
- **Passing pages:** `act`/`observe`/`extract`/agent `execute` accept `{ page }` with a Playwright page.
- **Model + key:** `model: 'google/<model-id>'` (also `anthropic/…`, `openai/…`) or `model: { modelName, apiKey }`. Per-call override via `{ model }` in options.
- **Env names Stagehand reads itself:** Google → `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` (first one set wins); Anthropic → `ANTHROPIC_API_KEY`; OpenAI → `OPENAI_API_KEY`. These match SPEC §8, so no mapping is needed. We will still pass `apiKey` explicitly so our own detection decides.
- **`act`:** `act(instruction: string, options?)` or `act(action: Action, options?)` → `{ success, message, actionDescription, actions }`. Options: `model`, `variables`, `timeout`, `page`.
- **`observe`:** `observe(instruction?, options?)` → `Action[]`, each `{ selector, description, method?, arguments? }`. Options add `selector`, `ignoreSelectors`.
- **`extract`:** `extract(instruction, zodSchema, options?)` → data typed by the schema; `extract(instruction)` → `{ extraction: string }`; `extract()` → `{ pageText }`.
- **`agent`:** `sh.agent({ systemPrompt?, model?, mode?, tools? }).execute(instruction | { instruction, maxSteps?, page?, signal? })` → `{ success, message, actions, completed, usage? }`. We plan not to use it for flows: its clicks happen inside Stagehand where our safety guard cannot veto them. Flows will use `observe()` → guard → `act(action)`.
- **Usage counters:** `await sh.metrics` gives token totals per act/extract/observe; `await sh.history` lists calls. We count LLM calls ourselves for the 150-call budget.
- **zod:** peer range `^3.25.76 || ^4.2.0`; we use zod 4.
- **Verified in M4 with a live key (2026-11-13):**
  - `act(observedAction, { page })` works on Playwright-owned pages and makes **no** AI call (source: `takeDeterministicAction` in `handlers/actHandler.js`; measured: 0 calls).
  - **`selfHeal` must be `false`.** With the default (`true`), a failed `act(action)` takes a new snapshot, asks the model for another element and performs the method on that new selector. Measured with `selfHeal: false`: a failing action returns `success: false` and makes 0 calls.
  - `observe` = 1 model call (about 2 s on `gemini-3.5-flash-lite`); `extract` with a schema = 2 model calls.
  - Counting calls: `model: { modelName, apiKey, middleware }` accepts an AI SDK `LanguageModelV2Middleware`; `wrapGenerate`/`wrapStream` see every real request (also retries). `await sh.metrics` only gives token totals.
  - Supported action methods: `click`, `fill`, `type`, `press`, `scrollTo`, `nextChunk`, `prevChunk`, `selectOptionFromDropdown`, `hover`, `doubleClick`, `dragAndDrop`.
  - Observed selectors are absolute XPaths such as `xpath=/html[1]/body[1]/main[1]/form[1]/input[1]`.
  - Pass `logger: () => undefined` as well as `verbose: 0`, otherwise failed actions print to the terminal.
- **Page scripts must be plain text.** Functions given to `page.evaluate` break under `tsx` (dev mode) when they contain named inner functions (`__name is not defined`). See `checks/collect.ts` and `browser/element.ts`.
