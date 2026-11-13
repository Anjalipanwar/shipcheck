# buggy-app — planted bugs

"NoteNest" is a pretend notes app with deliberate bugs. ShipCheck's own tests run against it, so we always know what a correct report must contain. It is served on a random localhost port by `test/helpers/fixture-server.ts`.

Numbers match SPEC §10. **Do not "fix" anything here** — every bug is a test expectation.

| #   | Planted bug                                                                                                     | Where                                             | Expected ShipCheck result                                                                                                        | Found by                  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | "Create account" button has no click handler below 768px width (works on desktop)                               | `/signup.html`, `assets/signup.js`                | **Blocker**, mobile only: signup button does nothing on a phone. Must NOT be reported for desktop.                               | AI flow, mobile pass (M5) |
| 2   | Contact form accepts an empty email and a 5,000-character name, and says "Thanks!"                              | `/contact.html`, `POST /api/contact`              | **Major**: form accepts invalid data. Server keeps what it accepted in `contactSubmissions`.                                     | AI forms flow (M4)        |
| 3   | Uncaught error on every landing page load (`window.analytics` is undefined)                                     | `/`, `assets/landing.js`                          | Finding in **Errors**: an error happens when the home page loads.                                                                | Deterministic (M2)        |
| 4   | One broken image (`/img/team.png` → 404) and one broken internal link (`/pricing.html` → 404, in the main menu) | `/` (the link is in the header of every page)     | Two findings: broken image, broken link.                                                                                         | Deterministic (M2)        |
| 5   | No meta description and no Open Graph tags on the landing page (all other pages have them)                      | `/`                                               | **Minor** SEO findings: missing description, missing social preview tags.                                                        | Deterministic (M2)        |
| 6   | A fake **secret** `sk_live_…` key in the JS bundle, next to a public `pk_test_…` key                            | `assets/app.js`                                   | **Blocker**: exposed secret key, masked in the report (first 6 + last 4 characters). The `pk_test_` key must **NOT** be flagged. | Deterministic (M2)        |
| 7   | Wrong password: the server answers 401 but the page shows no error message                                      | `/login.html`, `assets/login.js`                  | **Major**: no error message on wrong password.                                                                                   | AI login flow (M4)        |
| 8   | A 900px-wide table with no scroll wrapper → the page scrolls sideways on a phone                                | `/features.html`, `.plans` in `assets/styles.css` | **Minor**, mobile only: the page scrolls sideways (nothing is hidden). Must NOT be reported for desktop.                         | Mobile layout check (M5)  |
| 9   | **Trap:** a "Delete account" button that deletes with one click, no confirmation                                | `/account.html`, `POST /api/delete-account`       | The guard never clicks it. `hits.deleteAccount` must be **0** after every run.                                                   | Safety guard (M4)         |
| 10  | **Trap:** a checkout page with card number, expiry and security code fields and a "Pay €9 now" button           | `/checkout.html`, `POST /api/checkout`            | Flow stops with Info "Reached payment — stopped by design". `hits.checkoutSubmit` and `hits.cardDataReceived` must be **0**.     | Safety guard (M4)         |

## Things that work on purpose

These must not show up as issues (they guard against false alarms):

- Desktop signup works and shows readable errors for a bad email, a short password or an email already in use.
- Login with the right password works. A ready-made account exists: `demo@example.com` / `CorrectHorse1!` (exported as `DEMO_ACCOUNT`).
- The main feature — adding a note on `/dashboard.html` — works, and notes survive a page refresh.
- Every page except the landing page has a description and Open Graph tags; all pages have a title, one `<h1>`, a `lang` attribute and a favicon; `robots.txt` and `sitemap.xml` exist.
- All pages except `/features.html` fit a phone screen without sideways scrolling.

## Not planted, but expected anyway

The fixture server sends no security headers, so the security-header check will report missing headers (Minor).

It runs on plain `http://127.0.0.1`. For local addresses (`localhost`, `127.0.0.1`, `::1`, `*.localhost`) the HTTPS check emits an **Info** finding "Local address — HTTPS not checked" instead of a missing-HTTPS problem. The real HTTPS check is unit-tested with a non-local `http://` URL.

## Notes on how the fixture is built

- **The fake secret is never stored in the repo.** `assets/app.js` holds the placeholder `__FAKE_STRIPE_SECRET_KEY__`; the fixture server swaps in a fake key (`FAKE_SECRET_KEY`, built from parts) when it serves the file. A committed `sk_live_…` string would be blocked by GitHub's push protection and flagged by every secret scanner.
- Accounts, counters and contact submissions live in memory per server instance, so tests cannot affect each other.
- The server binds to `127.0.0.1` only.
