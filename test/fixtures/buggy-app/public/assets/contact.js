document.getElementById("contact-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  // Planted bug #2: no validation at all — empty email and a 5,000-character name are accepted.
  // Planted bug #11: the button stays active while sending, so a double click sends twice.
  await postJson("/api/contact", {
    name: document.getElementById("contact-name").value,
    email: document.getElementById("contact-email").value,
    message: document.getElementById("contact-message").value,
  });
  showMessage("contact-result", "Thanks! We got your message.", "ok");
});
