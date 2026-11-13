// Shared "bundle" loaded on every page.
// Planted bug #6: a SECRET payment key shipped to the browser. The value is injected by the
// fixture server (see test/helpers/fixture-server.ts) so no secret-looking string is committed.
var PAYMENT_CONFIG = {
  secretKey: "__FAKE_STRIPE_SECRET_KEY__",
  // Publishable keys are public by design — ShipCheck must NOT flag this one.
  publishableKey: "pk_test_FAKEshipcheckFIXTURE0000public1",
};

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    /* empty body */
  }
  return { ok: response.ok, status: response.status, data: data };
}

function showMessage(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "message " + (kind || "");
}
