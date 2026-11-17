# ShipCheck

**A QA engineer's pre-launch checkup for your vibe-coded app — in one command.**

You built an app with Lovable, Bolt, v0, Replit, Cursor or Claude Code and you are about to share the link. ShipCheck opens your app in a real browser, uses it like a first-time visitor — signs up, logs in, tries the main feature, fills in forms, on desktop and on a phone — and writes a report in plain English: what is broken, the proof (screenshots and steps), and a ready-made prompt you can paste into your AI builder to fix it.

```
npx @anjalipanwar/shipcheck https://myapp.lovable.app
```

**Only test apps you own or have permission to test.**

- **Sample reports**, made from a pretend app with planted bugs (the HTML version is what opens on your computer):
  - [Full check](examples/reports/buggy-app-full.md) — with an AI key: sign-up, log-in, main feature, forms, on desktop and phone, plus the automatic checks ([HTML version](examples/reports/buggy-app-full.html))
  - [Automatic checks only](examples/reports/buggy-app.md) — what `--no-ai` gives you without a key ([HTML version](examples/reports/buggy-app.html))
- Free and open source (MIT). Runs on your computer. You bring your own AI key — a free one is enough.

## Quickstart (about 5 minutes)

1. **Install Node.js** 22.12 or newer from [nodejs.org](https://nodejs.org) (the "LTS" download). To check what you have, type `node --version` in a terminal.
2. **Get a free AI key** — see [the next section](#get-a-free-ai-key).
3. **Run ShipCheck** in a terminal, with your app's address:

   ```
   npx @anjalipanwar/shipcheck https://myapp.lovable.app
   ```

   ShipCheck asks once whether you may test this app, shows its progress line by line, and opens the report in your browser when it is done (usually 2–4 minutes). The report is also saved in the folder `shipcheck-report`.

The very first time, ShipCheck may tell you that its test browser is not installed and show the one command that installs it. Run that command, then run ShipCheck again.

Also the very first time, npm itself may print a few warnings before ShipCheck starts: `npm warn ERESOLVE overriding peer dependency`, `npm warn deprecated node-domexception`, and with newer npm versions a list of "install scripts" it did not run. They come from packages that ShipCheck's browser-automation library uses, and they are harmless: ShipCheck works without those scripts, and you can ignore the warnings.

## Get a free AI key

ShipCheck uses an AI model to look at your app the way a person would. You need a key for it; Google gives one away for free.

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and click **Create API key**.
2. In the folder where you run ShipCheck, create a file named `.env` with this one line:

   ```
   GEMINI_API_KEY=paste-your-key-here
   ```

   (Or, for this terminal window only: `export GEMINI_API_KEY=paste-your-key-here`.)

3. Run ShipCheck again.

Keys from Anthropic (`ANTHROPIC_API_KEY`) and OpenAI (`OPENAI_API_KEY`) work too. Never share your key and never commit the `.env` file.

**No key at all?** Add `--no-ai` to run only the automatic checks (broken links, hidden errors, phone layout, SEO, basic security, accessibility). They need no key, but they cannot tell you whether signing up or your main feature works.

## What ShipCheck checks

**Using your app like a visitor** (the full check, needs an AI key)

| Area         | What it does                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Sign-up      | Creates a test account with a made-up email address and password.                                            |
| Log-in       | Tries a wrong password (is there a clear message?), then the right one, then refreshes the page.             |
| Main feature | Works out what your app is for, tries it, and checks that what was entered is still there after a refresh.   |
| Forms        | Sends forms empty, with wrong input and with a double click. No attack payloads — only messy, harmless data. |
| On a phone   | Does the same again on a phone-sized screen.                                                                 |

**Automatic checks** (always run, no key needed)

| Area                | What it looks for                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Phone screen layout | Pages that scroll sideways, buttons too small to tap or cut off, a menu that does not open. |
| Hidden errors       | Crashes in your app's code and failed requests that visitors do not see.                    |
| Broken links        | Links and images that lead nowhere.                                                         |
| SEO                 | Title, description, link previews, sitemap, a page that is blank without JavaScript.        |
| Basic security      | HTTPS, recommended security settings, secret keys left visible in your pages.               |
| Accessibility       | Serious problems for people who use a screen reader or need good contrast.                  |

Every problem in the report comes with evidence. No evidence, no finding. Each one is marked **Blocker** (stops people using your app), **Major** (breaks or confuses many people) or **Minor** (polish), and the report says clearly which parts it could **not** test and why.

## Add a test account

Some apps cannot be tested by a newcomer: they ask new users to confirm their email address, show a CAPTCHA, or only offer "Sign in with Google". ShipCheck then reports sign-up or log-in as "Not tested". To test the rest, create a test account in your app yourself and give it to ShipCheck:

```
npx @anjalipanwar/shipcheck https://myapp.lovable.app --email test@example.com --password "the-test-password"
```

Better, so the password does not end up in your terminal history: put these two lines into the `.env` file next to your AI key.

```
SHIPCHECK_EMAIL=test@example.com
SHIPCHECK_PASSWORD=the-test-password
```

Use an account made for testing, never your own. ShipCheck never writes a password into a report, a log or a screenshot description.

## Options

| Option                  | What it does                                                                       | Default                   |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| `--email`, `--password` | A test account for the log-in check (see above).                                   | ShipCheck signs up itself |
| `--goal "<text>"`       | The main task of your app in plain English, e.g. `--goal "book a 30-minute slot"`. | ShipCheck works it out    |
| `--flows <list>`        | Check only some parts: `landing,signup,login,core,forms`.                          | all                       |
| `--skip-mobile`         | Leave out the phone-sized pass.                                                    | off                       |
| `--no-ai`               | Only the automatic checks. Needs no AI key.                                        | off                       |
| `--max-minutes <n>`     | Stop after this many minutes and report what was tested until then.                | 10                        |
| `--fail-on <level>`     | For automation: exit with an error at `blocker`, `major` or `none`.                | `blocker`                 |
| `--out <folder>`        | Where the report is written.                                                       | `./shipcheck-report`      |
| `--model <id>`          | Use a specific AI model.                                                           | chosen from your key      |
| `--headed`              | Show the browser while ShipCheck works.                                            | off                       |
| `--yes`                 | Skip the "may you test this app?" question.                                        | off                       |

**Settings file.** Instead of typing options every time, you can put them into a file named `shipcheck.config.json` in the folder where you run ShipCheck. Use the option names without dashes, the second word capitalised:

```json
{
  "goal": "book a 30-minute slot",
  "skipMobile": true,
  "maxMinutes": 5,
  "failOn": "major"
}
```

The password and "yes" are not accepted in this file, on purpose: a file like this is easily shared or committed. An option typed on the command line wins over the file.

**Exit codes** (for scripts): `0` = no problems at the `--fail-on` level, `1` = problems found, `2` = ShipCheck itself could not run (wrong address, no AI key, …).

## Use it on GitHub

ShipCheck can run in GitHub Actions, for example by hand before each launch. Copy [`examples/github-workflow.yml`](examples/github-workflow.yml) into your repository as `.github/workflows/shipcheck.yml` and follow the four steps at the top of that file. In short:

```yaml
- uses: Anjalipanwar/shipcheck@v0
  with:
    url: https://myapp.lovable.app
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
    email: ${{ secrets.SHIPCHECK_EMAIL }} # optional
    password: ${{ secrets.SHIPCHECK_PASSWORD }} # optional
```

The run's summary page shows the verdict and the list of problems; the full report is attached to the run as the `shipcheck-report` artifact. Keys and passwords belong in repository secrets, never in the workflow file.

## What ShipCheck will never do

These rules are built into the code, not just written into instructions for the AI:

- **It stays on your app.** It does not follow links to other websites.
- **It never pays.** At a payment page it stops and tells you. Test your payment yourself with a test card.
- **It does not delete, send, invite or publish, and it does not log out.** Buttons like "Delete account", "Send" or "Log out" are not clicked — also when they show only an icon (a bin, a paper plane). A "Send" button is only used on a contact form, where you are the one who receives the message. A button with no name at all is not clicked either.
- **It does not attack.** No hacking attempts, only the kind of messy input real people type.
- **It has a time limit and an AI-call limit**, so a run cannot go on forever or use up your key.
- **It keeps secrets secret.** Passwords and your AI key are never written to the report or any file.

## Limits — please read

ShipCheck is an automated pre-launch check. It is not a security audit and not a guarantee that your app is free of bugs.

- **Not checked:** active security testing, completing a payment, emails your app sends, business rules beyond what is visible on screen, behaviour under heavy traffic, and native mobile apps.
- It tests in one browser (Chromium, the engine of Chrome and Edge), not in Safari or Firefox.
- It cannot confirm an email address, solve a CAPTCHA or use "Sign in with Google" — [add a test account](#add-a-test-account) for those apps.
- An AI is involved, so two runs on the same app can differ a little. When ShipCheck is not sure whether something worked, it says "Not tested" instead of guessing. A Blocker always needs proof of failure.
- Your app gets real test data: a test account, a few test entries, a contact-form message. Run it on an app where that is fine.

## Privacy and cost

- ShipCheck runs on your computer (or in your own GitHub Actions run). There is no ShipCheck server and no account.
- What the AI sees of your app — page content, to decide what to click — goes only to the AI provider whose key you use (Google, Anthropic or OpenAI), under your own key and their terms.
- The report stays on your computer. In GitHub Actions it is attached to your own workflow run, in your own repository. ShipCheck sends it nowhere else.
- ShipCheck is free. A typical run makes about 30–40 AI requests (never more than 150). In our own test runs a free Google key was enough for that; the limits of free keys are set by the provider and can change.

## Questions

**It says "Not tested" for sign-up or log-in.** Your app probably asks for an email confirmation or a CAPTCHA. [Add a test account](#add-a-test-account).

**It says the main feature could not be confirmed.** Tell ShipCheck what your app is for: `--goal "book a 30-minute slot"`.

**It says the AI limit of my key was reached.** Free keys allow a limited number of requests per minute and per day. Wait a little (or until tomorrow) and try again, or check fewer parts at a time: `--flows core`.

**The report shows a problem that is not one.** That can happen. Please [open an issue](https://github.com/Anjalipanwar/shipcheck/issues) and include the finding's title — false alarms are treated as bugs.

**Can I run it on someone else's website?** Only with their permission.

## Run it from the source code

For contributors, or to try the newest state before it is released:

```
git clone https://github.com/Anjalipanwar/shipcheck.git
cd shipcheck
npm install
npx playwright install chromium
npm run build
node dist/cli.js https://myapp.lovable.app
```

To try it without your own app: `npm run fixture` starts a pretend app with planted bugs at `http://127.0.0.1:4173`; check it from a second terminal with `node dist/cli.js http://127.0.0.1:4173 --no-ai`.

## Contributing and security

Bug reports, false alarms and ideas are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem in ShipCheck itself, see [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
