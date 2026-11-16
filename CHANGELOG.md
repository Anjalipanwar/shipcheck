# Changelog

All notable changes to ShipCheck are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.1.0] — 2026-11-16

First version.

### Added

- **The full check:** an AI uses the app like a first-time visitor — sign-up, log-in (wrong password, right password, refresh), the main feature, forms with missing and wrong input — on desktop and on a phone-sized screen.
- **Automatic checks** that need no AI key (`--no-ai`): phone screen layout and menu, hidden errors, broken links and images, SEO basics, basic security (HTTPS, security settings, exposed secret keys), accessibility.
- **The report** as `report.html`, `report.md` and `report.json`: a verdict, "What this report covers" (what was tested, what was not, and why), every problem with evidence, steps to reproduce and a fix prompt for AI builders.
- **Safety rules in code:** stays on the tested site, never pays, never deletes or sends, no attack payloads, time and AI-call limits, no password or key in any output, ownership confirmation.
- **Command line:** options for a test account, the main task, parts to check, time limit, `--fail-on`, output folder, model; a `shipcheck.config.json` settings file; exit codes 0 / 1 / 2; the report opens by itself when the run is done.
- **GitHub Action** with run summary and report artifact, and an example workflow to copy.
