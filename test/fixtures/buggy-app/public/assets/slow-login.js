// Works on purpose — slowly, like a real app that talks to a sign-in service: the button shows
// "Logging in…" for a while before the answer arrives. A wrong password then gets a clear
// message; the right one opens the dashboard. A tester that judges the loading label reports
// "no message on a wrong password" and "users cannot log in" — both false alarms.
var ANSWER_DELAY_MS = 1800;

// Variant /slow-login.html?lazy=1: like an app that changes the address first and loads the
// screen behind it afterwards. After the right password the address becomes ?inside=1 at once,
// but the log-in form stays on screen for 2.5 more seconds before the app appears.
function showInside() {
  document
    .querySelectorAll("#login-form label, #login-form input, #login-form button, #login-message")
    .forEach(function (el) {
      el.hidden = true;
    });
  var inside = document.createElement("p");
  inside.id = "inside";
  inside.textContent = "Welcome back. Your notes are below.";
  document.getElementById("login-form").appendChild(inside);
}
if (window.location.search.indexOf("inside") !== -1) showInside();

document.getElementById("login-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var button = document.querySelector("#login-form button");
  var email = document.getElementById("login-email").value;
  var password = document.getElementById("login-password").value;
  button.disabled = true;
  button.textContent = "Logging in…";
  await new Promise(function (resolve) {
    setTimeout(resolve, ANSWER_DELAY_MS);
  });
  var result = await postJson("/api/login", { email: email, password: password });
  if (result.ok && window.location.search.indexOf("inplace") !== -1) {
    // Variant /slow-login.html?inplace=1: the app opens in place — same address, the fields go
    // away, and a message left over from an earlier wrong password is sloppily left standing.
    document.querySelectorAll("#login-form label, #login-form input, #login-form button").forEach(function (el) {
      el.hidden = true;
    });
    var inside = document.createElement("p");
    inside.id = "inside";
    inside.textContent = "Welcome back. Your notes are below.";
    document.getElementById("login-form").appendChild(inside);
    return;
  }
  if (result.ok && window.location.search.indexOf("lazy") !== -1) {
    history.pushState({}, "", "/slow-login.html?inside=1");
    setTimeout(showInside, 2500);
    return;
  }
  if (result.ok) {
    setTimeout(function () {
      window.location.href = "/dashboard.html";
    }, 1200);
    return;
  }
  button.disabled = false;
  button.textContent = "Log in";
  showMessage("login-message", "Invalid login credentials", "error");
});
