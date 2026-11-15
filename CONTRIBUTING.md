# Contributing to ShipCheck

Thank you for helping. ShipCheck is a QA tool, so its own quality bar is high — but small contributions are very welcome, and a good bug report is one of the most useful.

## Reporting a problem

Please [open an issue](https://github.com/Anjalipanwar/shipcheck/issues/new/choose). The two most valuable kinds:

- **A false alarm** — ShipCheck reported a problem that is not one. Include the finding's title and what really happens in the app.
- **A miss** — ShipCheck did not notice a real problem, or said "Not tested" for something that works.

Do not paste passwords, AI keys or private data into an issue. For a security problem in ShipCheck itself, see [SECURITY.md](SECURITY.md).

## Working on the code

You need Node.js 22.12 or newer.

```
git clone https://github.com/Anjalipanwar/shipcheck.git
cd shipcheck
npm install
npx playwright install chromium
```

Before you open a pull request, all of these must pass:

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

- `npm test` runs the unit tests (fast). `npm run test:e2e` runs ShipCheck in a real browser against a pretend app with planted bugs in `test/fixtures/buggy-app` (about five minutes). Neither needs an AI key.
- `npm run fixture` starts that pretend app at `http://127.0.0.1:4173` so you can try things by hand.
- `npm run test:ai` uses a real AI key and its quota. It is not part of the normal checks.

## Rules of the house

- **No finding without evidence.** A "Blocker" needs proof of failure (an error message, a refused request, nothing happening) — missing proof of success is "Not tested".
- **A false alarm is a bug.** Reproduce it on the fixture app with a failing test first, then fix it.
- **Never test against real third-party websites in automated tests.** Use the fixture app.
- **Safety rules are code, not prompts:** stay on the tested site, never pay, never delete or send, no attack payloads, no secrets in any output. See "What ShipCheck will never do" in the [README](README.md).
- **Report text is for non-technical readers.** Plain words, no jargon.
- Write tests alongside code. TypeScript strict; small modules; all AI prompts live in `src/ai/prompts.ts`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`fix(flows): …`, `feat(report): …`).
- ShipCheck must stay free to run and to maintain: no hosted services, no required paid APIs.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
