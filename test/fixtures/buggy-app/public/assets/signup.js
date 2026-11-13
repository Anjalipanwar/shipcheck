async function submitSignup() {
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-password").value;
  const result = await postJson("/api/signup", { email: email, password: password });
  if (result.ok) {
    window.location.href = "/dashboard.html";
  } else {
    showMessage("signup-message", result.data.error || "Sign up failed. Please try again.", "error");
  }
}

// Planted bug #1: the click handler is only attached on wide screens, so on a phone the
// "Create account" button does nothing at all.
if (window.matchMedia("(min-width: 768px)").matches) {
  document.getElementById("signup-button").addEventListener("click", submitSignup);
}
