# Changelog

All notable changes to ShipCheck are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.1] — 2026-11-17

Safety and robustness fixes from an independent review before the announcement (`docs/AUDIT-v0.1.0.md`).

### Fixed

- **Stays on your site, also through redirects.** When the server forwarded the browser (after a click, a form or on the home page itself), the redirect was not checked, so the browser could end up on another website. Every redirect step is now checked before it is followed. An app address that forwards to another website stops with a plain message and the address to use instead, rather than a report about a page that is not your app.
- **Passwords hidden in every spelling.** A password that ended up in a page address (for example from a form sent without a script), inside JSON or HTML-escaped is now hidden too, and so is any password-like value in an address.
- **An everyday word as test password no longer breaks the run.** With a password such as `test` or `check`, the run used to end with "unexpected problem" and no report. Only free text is hidden now, and longer words that merely contain the password stay readable.
- **`--max-minutes` is a hard stop.** A very heavy page could keep the run going forever with no report. Now the run stops at the time limit and writes a report with what it checked so far, marked as partial.
- **A report folder that cannot be written** is found before the app is opened, with a plain message, instead of after the whole run.
- **The safety guard reads more and refuses more:** "Log out", a plain "Send" (except on a contact form), "Archive", "Move to trash", "Disable", "Disconnect" and their German forms; also buttons that show only an icon (a bin, a paper plane, a log-out arrow), judged by their icon names, inner labels, ids and test ids. A button with no readable name at all is not clicked.
- **Dependencies:** the versions in this repository's lock file have no known vulnerabilities (19 before, 2 of them high), with Stagehand unchanged at 3.7.3. The GitHub Action installs exactly these. An install with `npx` or `npm install` still gets the newest versions Stagehand allows, which include the two high advisories; the affected code only parses multipart form answers, which the AI library ShipCheck uses never asks it to do; fixing that needs a Stagehand change and is planned for v0.2.

### Changed

- The README says that npm may print a few harmless warnings on the very first `npx` run (issue #1).

## [0.1.0] — 2026-11-16

First version.

### Added

- **The full check:** an AI uses the app like a first-time visitor — sign-up, log-in (wrong password, right password, refresh), the main feature, forms with missing and wrong input — on desktop and on a phone-sized screen.
- **Automatic checks** that need no AI key (`--no-ai`): phone screen layout and menu, hidden errors, broken links and images, SEO basics, basic security (HTTPS, security settings, exposed secret keys), accessibility.
- **The report** as `report.html`, `report.md` and `report.json`: a verdict, "What this report covers" (what was tested, what was not, and why), every problem with evidence, steps to reproduce and a fix prompt for AI builders.
- **Safety rules in code:** stays on the tested site, never pays, never deletes or sends, no attack payloads, time and AI-call limits, no password or key in any output, ownership confirmation.
- **Command line:** options for a test account, the main task, parts to check, time limit, `--fail-on`, output folder, model; a `shipcheck.config.json` settings file; exit codes 0 / 1 / 2; the report opens by itself when the run is done.
- **GitHub Action** with run summary and report artifact, and an example workflow to copy.
