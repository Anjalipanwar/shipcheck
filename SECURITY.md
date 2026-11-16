# Security

## Reporting a security problem in ShipCheck

Please do **not** open a public issue for a security problem. Report it privately through GitHub: on the repository page, open the **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/Anjalipanwar/shipcheck/security/advisories/new)).

Please include what you found, how to reproduce it, and which version you used. I aim to reply within 7 days.

Things that count as a security problem in ShipCheck:

- a password, AI key or other secret ending up in a report, a log, the terminal or any file;
- ShipCheck leaving the tested website, submitting a payment, or deleting or sending something;
- a tested web page being able to make ShipCheck run commands or hide its own problems from the report.

## What ShipCheck is not

ShipCheck is a pre-launch check, not a security audit. It does no active security testing of the apps it checks, and a clean report does not mean an app is secure.

## Supported versions

Only the latest released version receives fixes.
