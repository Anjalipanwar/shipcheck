# ShipCheck pre-launch report

**Verdict: Automatic checks found issues** — 1 Blocker · 1 Major · 6 Minor · 1 Info

Blocker = stops people using your app · Major = breaks or confuses many people · Minor = polish

At least one is a blocker: fix it before you launch. ShipCheck did not use your app like a visitor, so a full check may find more.

- **App:** http://127.0.0.1:4173/
- **Date:** 15 November 2026, 23:58 UTC
- **Duration:** 2 seconds
- **AI model:** None — automatic checks only
- **ShipCheck version:** 0.1.0

## What this report covers

**Automatic checks only (no AI)** — ShipCheck loaded your pages and checked them from the outside: hidden errors, broken links, phone screen layout, SEO and basic security. It did not sign up, log in or use any feature.

**Using your app like a visitor (full check only)**

| Area | Result |
| --- | --- |
| Sign-up | ○ Not tested: this needs the full check |
| Log-in | ○ Not tested: this needs the full check |
| Main feature | ○ Not tested: this needs the full check |
| Forms (including wrong or missing input) | ○ Not tested: this needs the full check |
| Using it on a phone | ○ Not tested: this needs the full check |

**Automatic checks (always run)**

| Area | Result |
| --- | --- |
| Phone screen layout | ⚠ 1 problem (worst: Minor) |
| Hidden errors | ⚠ 1 problem (worst: Minor) |
| Broken links | ⚠ 2 problems (worst: Major) |
| SEO | ⚠ 2 problems (worst: Minor) |
| Basic security | ⚠ 2 problems (worst: Blocker) |
| Accessibility | ✓ No problems found |

Automatic checks can’t find problems that only appear when someone uses the app, such as a sign-up that fails or a button that does nothing. That’s why a full check often finds more than automatic checks.

**Next step:** Run the full check to test your app like a real visitor. You need a free AI key.

```text
npx @anjalipanwar/shipcheck http://127.0.0.1:4173/
```

[How to get a free AI key](https://github.com/Anjalipanwar/shipcheck#get-a-free-ai-key)

## Fix these first

1. **Blocker** — A secret key is visible to anyone who visits your app (Stripe secret key)
2. **Major** — The “Pricing” link in your main menu leads to a page that does not exist
3. **Minor** — 4 recommended security settings are switched off

## All issues (9)

### Mobile

#### A page scrolls sideways on a phone

**Minor** · Mobile · Phone · Verified

**What happened:** On a phone-sized screen (390 px wide), the page is wider than the screen, so visitors can drag it sideways and the layout wobbles. The cause on /features.html is a table that is 900 px wide.

**Why it matters:** Most visitors come on a phone. A page that slides sideways feels broken and makes text harder to read.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/features.html on a phone (or in Chrome: right-click → Inspect → the phone icon, choose “iPhone 12 Pro” or similar).
2. Swipe left: the page moves sideways.

**Evidence:**

- Where: http://127.0.0.1:4173/features.html
- Screenshot: screenshots/02-mobile-layout-features-html.jpg

```text
http://127.0.0.1:4173/features.html: page is 916 px wide on a 390 px screen — widest part: table.plans, 900 px
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
On a phone (390 px wide), these pages of my app are wider than the screen and scroll sideways. Please make them fit: let wide elements shrink or wrap, or put wide tables in a container with "overflow-x: auto". Do not hide the overflow on <body>.
- http://127.0.0.1:4173/features.html (cause: table.plans, 900 px wide)
```

### Across the app

#### The “Pricing” link in your main menu leads to a page that does not exist

**Major** · Functionality · Desktop and phone · Verified

**What happened:** One link points to an address that answers with “not found” or an error. It sits where almost every visitor looks: the page header, the main menu or a main button.

**Why it matters:** Visitors use the menu and the main buttons to find their way around and to sign up. A dead end there loses them at exactly the moment they were interested.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/.
2. Click the link “Pricing” that goes to http://127.0.0.1:4173/pricing.html.
3. An error page appears instead of the expected page.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
404 http://127.0.0.1:4173/pricing.html (“Pricing” in the page header or main menu) — found on http://127.0.0.1:4173/
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
These links in my app are broken. For each one, either create the missing page, point the link to the right address, or remove the link:
- http://127.0.0.1:4173/pricing.html (“Pricing” in the page header or main menu) (linked from http://127.0.0.1:4173/)
```

#### An image in your app does not load

**Minor** · Functionality · Desktop and phone · Verified

**What happened:** One image file is missing, so visitors see an empty box or a broken-picture icon.

**Why it matters:** Missing pictures make a page look broken and unfinished.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/.
2. Look for an empty box or broken-picture icon where an image should be.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
404 http://127.0.0.1:4173/img/team.png — found on http://127.0.0.1:4173/
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
These images fail to load in my app. Please fix the file paths or add the missing files:
- http://127.0.0.1:4173/img/team.png (used on http://127.0.0.1:4173/)
```

### Security

#### A secret key is visible to anyone who visits your app (Stripe secret key)

**Blocker** · Security · Desktop and phone · Verified

**What happened:** A Stripe secret key is included in the files your app sends to every visitor’s browser. Anyone can read it by viewing the page’s source. Key found: sk\_liv…eal1 (shortened here on purpose).

**Why it matters:** A secret key works like a password to your account with that service. Someone who copies it can run up charges, read private data or delete things in your name.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/assets/app.js in your browser.
2. Search the text (Ctrl/Cmd + F) for “sk\_liv”.

**Evidence:**

- Where: http://127.0.0.1:4173/assets/app.js

```text
Stripe secret key: sk_liv…eal1
Found in: http://127.0.0.1:4173/assets/app.js
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
A Stripe secret key (starting with "sk_liv") is exposed in my frontend code. Please: 1) remove it from all client-side code, 2) move every call that needs it to a server-side function or API route that reads the key from an environment variable, 3) tell me to revoke this key and create a new one in the provider's dashboard, because the old one must be treated as leaked.
```

#### 4 recommended security settings are switched off

**Minor** · Security · Desktop and phone · Verified

**What happened:** Your server does not send 4 standard protective instructions (“security headers”) to browsers: Content-Security-Policy (limits which scripts may run on your pages); X-Content-Type-Options (stops browsers from guessing file types); X-Frame-Options (or CSP frame-ancestors) (stops other sites from showing your app inside a hidden frame); Referrer-Policy (controls how much of your page address is shared with other sites).

**Why it matters:** They are an extra layer of protection that makes common attacks harder. Nothing is broken today, but they are quick to add.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/.
2. Open the developer tools → Network tab, reload, click the first request and look at “Response Headers”.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
Missing: Content-Security-Policy
Missing: X-Content-Type-Options
Missing: X-Frame-Options (or CSP frame-ancestors)
Missing: Referrer-Policy
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
Please add these HTTP security headers to every response of my app (via the hosting platform's config file or the server middleware):
- Content-Security-Policy
- X-Content-Type-Options
- X-Frame-Options (or CSP frame-ancestors)
- Referrer-Policy
Use safe defaults: "X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin", "X-Frame-Options: DENY" (or CSP frame-ancestors 'none'), "Strict-Transport-Security: max-age=31536000; includeSubDomains", and a Content-Security-Policy that allows only the sources the app really uses. Make sure the app still works afterwards.
```

#### Local address — HTTPS not checked

**Info** · Security · Desktop and phone · Verified

**What happened:** This app was tested on an address that only exists on this computer, so the secure-connection check was skipped.

**Why it matters:** Secure connections (HTTPS) only matter once the app is online. Run ShipCheck again on the public address before you launch.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
Address tested: http://127.0.0.1:4173
```

### Search and sharing (SEO)

#### Your home page has no description for search results

**Minor** · SEO · Desktop and phone · Verified

**What happened:** The home page does not include the short summary that search engines show under the title.

**Why it matters:** Without it, Google picks random text from the page, which usually reads badly and gets fewer clicks.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/.
2. Right-click the page and choose “View page source”.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
No <meta name="description"> found on the home page
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
Add a <meta name="description"> tag to my landing page: one or two sentences (max 155 characters) that explain what the app does and who it is for.
```

#### Links to your app show no preview when shared

**Minor** · SEO · Desktop and phone · Verified

**What happened:** The home page is missing the tags that create a preview card (title, text, picture) when someone shares your link on WhatsApp, LinkedIn, X or Slack. Missing: og:title, og:description, og:image.

**Why it matters:** A bare link gets far fewer clicks than one with a picture and headline — and launches mostly spread through shared links.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/.
2. Right-click the page and choose “View page source”.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
Missing Open Graph tags: og:title, og:description, og:image
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
Add Open Graph tags to my landing page's <head>: og:title, og:description, og:image (image 1200×630 px, absolute URL). Also add twitter:card "summary_large_image".
```

### Hidden errors

#### Part of your app’s code crashes in the background

**Minor** · Errors · Desktop and phone · Verified

**What happened:** While pages were loading, the app’s code hit 2 errors that it did not handle. Visitors don’t see a message, but whatever that code was meant to do did not happen.

**Why it matters:** A silent crash can leave buttons, tracking or other features not working, and it is often the first sign of a bigger bug.

**Steps to reproduce:**

1. Open http://127.0.0.1:4173/ in Chrome.
2. Open the developer tools (right-click → Inspect) and choose the Console tab.
3. Reload the page and look for red error lines.

**Evidence:**

- Where: http://127.0.0.1:4173/

```text
Cannot read properties of undefined (reading 'track') — on http://127.0.0.1:4173/ (×2)
```

**Fix prompt** (paste into Lovable, Bolt, Cursor or Claude Code):

```text
My app throws uncaught JavaScript errors while pages load. Please find the cause of each one and fix it so that no errors appear in the browser console on load. Errors:
- Cannot read properties of undefined (reading 'track') (page: http://127.0.0.1:4173/) (×2)
```

## What worked

- Home page opens
- Home page loads quickly (main content visible after 0.1 seconds)
- Home page has a title
- Home page has one main heading
- Home page states its language
- App has a browser-tab icon
- robots.txt file exists
- sitemap.xml file exists
- Page content is readable without JavaScript
- No serious accessibility problems found on the 2 pages we scanned
- 4 links and images on your own site work
- Buttons and menu links are big enough to tap on a phone
- No buttons are cut off or covered on a phone
- No failed requests for the app’s code or data

## What we couldn’t test

- Secure connection (HTTPS) — the app was tested on a local address
- Signing up, logging in, the main feature and forms, on desktop and on a phone — these need the full check (this run was automatic checks only). The phone layout was checked
- Payment requests were blocked by design (to js.stripe.com, r.stripe.com, api.stripe.com), so paying was not tested
- Error messages caused by this blocking were ignored (14 in total) — they are not problems in your app

---

ShipCheck is an automated pre-launch check. It is not a security audit and not a guarantee that the app is free of bugs.

Not checked: active security testing, completing a payment, emails the app sends, business rules beyond what is visible on screen, behaviour under heavy traffic, and native mobile apps.
