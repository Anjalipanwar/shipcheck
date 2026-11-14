// Works on purpose (see BUGS.md): a stand-in for a payment provider's script, like Stripe.js.
// It is served by the fixture itself, so no test ever downloads anything from a real provider.
// Like the real thing, it contacts the provider as soon as the page loads. ShipCheck blocks
// all of that by design, and must not report the resulting errors as bugs in the app.
(function () {
  var frame = document.createElement("iframe");
  frame.src = "https://js.stripe.com/v3/controller.html";
  frame.title = "Payment widget";
  frame.hidden = true;
  document.body.appendChild(frame);

  // A "page loaded" ping. Its failure is handled and logged as an error.
  fetch("https://r.stripe.com/b", { method: "POST", body: "event=load" }).catch(function (error) {
    console.error("PayWidget: could not reach r.stripe.com — " + error.message);
  });

  // A settings request whose failure is not handled at all ("Uncaught (in promise)").
  fetch("https://api.stripe.com/v1/elements/sessions").then(function (response) {
    return response.json();
  });
})();
