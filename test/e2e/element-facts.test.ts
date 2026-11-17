import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readElementFacts } from '../../src/browser/element.js';
import { judgeAction } from '../../src/browser/guard.js';

/**
 * Audit A-05: what the guard reads from real buttons in a real browser — accessible names, icon
 * labels and names, ids and test ids, the form around a "Send" button — and what it decides.
 */
let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(`
    <header><button data-k="b1" class="menu-button h-6 w-6"><svg viewBox="0 0 1 1"><path d=""/></svg></button></header>
    <main>
      <button data-k="b2"><svg class="lucide lucide-trash-2 h-4 w-4"><path d=""/></svg></button>
      <button data-k="b3"><svg><title>Delete note</title><path d=""/></svg></button>
      <button data-testid="logout-button" class="p-2"><svg class="h-5"><path d=""/></svg></button>
      <button data-k="b5"><i class="fa fa-paper-plane"></i></button>
      <button data-k="b6"><span aria-label="Remove item"><svg><path d=""/></svg></span></button>
      <button data-k="b7"><svg><use href="#icon-log-out"></use></svg></button>
      <button data-k="b8" class="p-2"><svg class="h-4 w-4"><path d=""/></svg></button>
      <button data-k="b9"><svg class="lucide lucide-plus"><path d=""/></svg></button>
      <a data-k="b10" href="/settings">Log out</a>
      <form id="chat"><textarea name="message"></textarea><button data-k="b11">Send</button></form>
      <form id="contact">
        <label for="n">Your name</label><input id="n" name="name" />
        <label for="e">Email</label><input id="e" name="email" type="email" />
        <label for="m">Message</label><textarea id="m" name="message"></textarea>
        <button data-k="b12" type="submit">Send message</button>
      </form>
      <form id="mail">
        <label for="t">To</label><input id="t" name="to" type="email" />
        <label for="e2">Your email</label><input id="e2" name="email" type="email" />
        <textarea name="body" aria-label="Message"></textarea>
        <button data-k="b13" type="submit">Send</button>
      </form>
    </main>`);
});
afterAll(async () => {
  await browser.close();
});

const verdictFor = async (selector: string) =>
  judgeAction(
    { selector, description: 'a button', method: 'click', arguments: [] },
    await readElementFacts(page, selector),
  );

describe('the guard reads names, icons and forms from real buttons (audit A-05)', () => {
  it.each([
    ['a Lucide trash icon', '[data-k="b2"]', 'destructive'],
    ['an svg title “Delete note”', '[data-k="b3"]', 'destructive'],
    ['a data-testid “logout-button”', '[data-testid="logout-button"]', 'log-out'],
    ['a Font Awesome paper plane', '[data-k="b5"]', 'outward'],
    ['an aria-label on an inner element', '[data-k="b6"]', 'destructive'],
    ['a sprite icon “#icon-log-out”', '[data-k="b7"]', 'log-out'],
    ['a “Log out” link to an innocent address', '[data-k="b10"]', 'log-out'],
    ['“Send” in a chat box', '[data-k="b11"]', 'outward'],
    ['“Send” in an email composer', '[data-k="b13"]', 'outward'],
  ])('refuses %s', async (_name, selector, kind) => {
    expect(await verdictFor(selector)).toMatchObject({ allowed: false, kind });
  });

  it('refuses a button with no name, no icon name and no id that says anything', async () => {
    expect(await verdictFor('[data-k="b8"]')).toMatchObject({ allowed: false, kind: 'unverified' });
  });

  it.each([
    ['an unlabeled menu button in the header', '[data-k="b1"]'],
    ['a plus icon', '[data-k="b9"]'],
    ['“Send message” on a contact form', '[data-k="b12"]'],
  ])('allows %s', async (_name, selector) => {
    expect(await verdictFor(selector)).toEqual({ allowed: true });
  });
});
