// Works on purpose (the opposite of planted bug #11): the button is disabled with the first
// click, so a quick double click sends the form only once.
document.getElementById("newsletter-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = document.getElementById("newsletter-button");
  if (button.disabled) return;
  button.disabled = true;
  const result = await postJson("/api/newsletter", {
    email: document.getElementById("newsletter-email").value,
  });
  if (result.ok) {
    showMessage("newsletter-message", "You are on the list.", "ok");
  } else {
    showMessage("newsletter-message", result.data.error || "Please try again.", "error");
    button.disabled = false;
  }
});
