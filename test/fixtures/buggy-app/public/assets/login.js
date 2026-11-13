document.getElementById("login-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const result = await postJson("/api/login", { email: email, password: password });
  if (result.ok) {
    window.location.href = "/dashboard.html";
  }
  // Planted bug #7: on a wrong password nothing happens — no error message is shown.
});
