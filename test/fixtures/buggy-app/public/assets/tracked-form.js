// Works on purpose: the page checks the input itself and sends nothing to /api/contact unless
// it is valid. But every click also sends a tracking beacon (a same-site POST answered 202),
// as hosting platforms and analytics tools do. A tester that takes any accepted POST for
// "the server accepted the form" reports a false alarm here.
function track(name) {
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: name }),
    keepalive: true,
  }).catch(function () {});
}

var sending = false;
document.getElementById("contact-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  track("contact_submit_clicked");
  var name = document.getElementById("contact-name").value.trim();
  var email = document.getElementById("contact-email").value.trim();
  var message = document.getElementById("contact-message").value.trim();
  if (!name) return showMessage("contact-result", "Please enter your name.", "error");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return showMessage("contact-result", "Please enter a valid email address.", "error");
  }
  if (!message || message.length > 2000) {
    return showMessage("contact-result", "Please write a message of up to 2,000 characters.", "error");
  }
  if (sending) return;
  sending = true;
  await postJson("/api/contact", { name: name, email: email, message: message });
  sending = false;
  showMessage("contact-result", "Thanks! We got your message.", "ok");
});
