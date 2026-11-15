# Launch assets — steps for the owner

Two things from M9 that only the owner can do. Both are optional (first on the cut list in `docs/BUILD_PLAN.md`): the README and the sample report in the repository are enough to launch.

## 1. The project page (GitHub Pages)

The page is ready in `docs-site/`: `index.html` (what ShipCheck is, quickstart link, link to the sample) and `sample-report.html` (the same report as `examples/reports/buggy-app.html`; `npm run sample` refreshes both).

Publishing it makes the page public at `https://anjalipanwar.github.io/shipcheck/`. Steps:

1. Tell Claude Code "add the Pages workflow". It adds a workflow that uploads `docs-site/` (GitHub's own `upload-pages-artifact` and `deploy-pages` actions); it is not in the repository yet, because it would fail until step 2 is done.
2. On GitHub: repository → **Settings** → **Pages** → under "Build and deployment", set **Source** to **GitHub Actions**.
3. Push. Open the address above and check: the page loads, "See a sample report" opens the report, the two GitHub links work.
4. Add the page's address to the repository's "About" box (the gear icon on the repository's front page → Website).

## 2. The demo GIF for the README

A short recording of one run, about 20–30 seconds, shown at the top of the README.

1. Terminal 1, in the `shipcheck` folder: `npm run fixture`
2. Make the second terminal window small (about 100 × 30 characters) with a large font, and clear it.
3. Start recording that window. On a Mac: press **Shift + Command + 5**, choose "Record Selected Portion", draw the frame around the terminal, click Record.
4. Terminal 2: `node dist/cli.js http://127.0.0.1:4173 --no-ai` and answer `y`. Wait until the report opens in the browser; scroll through it slowly for a few seconds if the browser is inside the frame.
5. Stop the recording (the stop button in the menu bar). You get a `.mov` file.
6. Turn it into a GIF, for example with the free app Gifski (Mac App Store): width 800, 10 frames per second. Aim for under 5 MB.
7. Save it as `docs-site/demo.gif` and tell Claude Code "add the demo GIF to the README". It then adds the image under the first paragraph and a test that the file exists.

A recording of the full check (with an AI key, against your own app) shows more, but it also shows your app and takes 2–4 minutes; the fixture run above shows nothing private.
