// Works on purpose — but slowly, like many real apps: after the server has created the account
// the page shows a loading label for a while and only then moves on to the dashboard.
// A tester that judges too early sees "…ing…" and the old address, and reports a false alarm.
var REDIRECT_DELAY_MS = 4500;
// The request itself is slow to start too (a real app first talked to its sign-in service).
var REQUEST_DELAY_MS = 1500;

document.getElementById("signup-button").addEventListener("click", async function () {
  var button = document.getElementById("signup-button");
  var email = document.getElementById("signup-email").value;
  var password = document.getElementById("signup-password").value;
  button.disabled = true;
  button.textContent = "Creating your account…";
  await new Promise(function (resolve) {
    setTimeout(resolve, REQUEST_DELAY_MS);
  });
  var result = await postJson("/api/signup", { email: email, password: password });
  if (!result.ok) {
    button.disabled = false;
    button.textContent = "Create account";
    showMessage("signup-message", result.data.error || "Sign up failed. Please try again.", "error");
    return;
  }
  showMessage("signup-message", "Signing you in…", "ok");
  setTimeout(function () {
    window.location.href = "/dashboard.html";
  }, REDIRECT_DELAY_MS);
});
