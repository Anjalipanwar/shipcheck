/**
 * Every instruction ShipCheck gives to the AI model lives in this file (project convention).
 * The instructions only ask the model to find things on the page or to describe what is visible.
 * What may be clicked or typed is decided by the guard in code, never by these words.
 */

export const PROMPTS = {
  landingTargets:
    'Find the main call-to-action button or link of this page (the one a first-time visitor is meant to click), and the links in the main navigation menu. Return each as a click action. Do not return log out, delete, payment or social media links.',

  signupEntry:
    'Find the link or button that opens the sign up / register / create account page or form. Return one click action. If the sign up form is already visible on this page, return nothing.',

  signupForm:
    'Find every input field of the sign up / create account form (for example name, email, password, repeat password), any checkbox that must be ticked to accept the terms, and the button that submits the form. Return the fields as fill actions, checkboxes as click actions and the submit button as a click action. Do not return "sign in with Google" or other social login buttons.',

  signupOutcome:
    'Look at the page after the sign up form was submitted. Decide: was the account created and is the user now inside the app or welcomed (accountCreated)? Does the page ask the user to confirm their email address before continuing (needsEmailVerification)? Is a CAPTCHA or "I am not a robot" check blocking the form (captchaBlocked)? Is an error or validation message visible, and what does it say (errorText, empty if none)?',

  loginEntry:
    'Find the link or button that opens the log in / sign in page or form. Return one click action. If the log in form is already visible on this page, return nothing.',

  loginForm:
    'Find the email or username field, the password field and the submit button of the log in / sign in form. Return the fields as fill actions and the button as a click action. Do not return "sign in with Google" or other social login buttons, and no "forgot password" link.',

  loginOutcome:
    'Look at the page after a log in attempt. Decide: is the user now logged in, i.e. inside the app or greeted by name (loggedIn)? Is a message visible that tells the user the log in failed, such as wrong email or password (errorVisible)? Quote that message (messageText, empty if none).',

  mainAction:
    'Look at this app as a first-time user. In one short imperative sentence, name the single main thing the app lets a user do here (for example "Add a note" or "Book a 30-minute slot"). Do not choose signing up, logging in, account settings, upgrading, paying or deleting anything.',

  nextStep: (goal: string, done: readonly string[]): string =>
    `A user wants to: ${goal}. ${
      done.length > 0 ? `Already done: ${done.join('; ')}. ` : ''
    }Find the single next action on this page that brings the user closer to that goal. For a text field return a fill action with short, harmless example text. Return exactly one action, or nothing if the goal already looks accomplished or nothing on the page helps. Never choose delete, remove, pay, buy, invite, share, publish or log out.`,

  goalOutcome: (goal: string, done: readonly string[]): string =>
    `A user tried to: ${goal}. These steps were carried out: ${done.join('; ')}. Look at the page now. Decide: does the page show that this worked, for example the new item is listed or a success message is shown (accomplished)? Is an error message visible (errorVisible)? In one plain sentence, say what the page shows that supports your answer (whatIsVisible).`,

  formFields:
    'Find every text input, email input and text area of the main form on this page, and the button that submits it. Return the fields as fill actions and the button as a click action. Ignore search boxes, log in forms, sign up forms and payment forms.',

  formOutcome:
    'A form on this page was just submitted. Decide: does the page show that the form was accepted, such as a thank-you or success message (accepted)? Does it show a validation message telling the user that something is missing or wrong (validationShown)? Quote the most relevant message (messageText, empty if none).',
} as const;
