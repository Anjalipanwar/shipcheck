// Works on purpose: a main feature that is used by clicking only, like a meal planner. "Add
// meal" opens a dialog with recipes; choosing one puts it into the day's list and closes the
// dialog (Escape closes it too). Nothing is typed, so a tester cannot prove the result by
// looking for its own text — it has to count the chosen item on the page before and after.
// Variant /planner.html?broken=1: choosing a recipe closes the dialog but adds nothing.
var picker = document.getElementById("picker");
var day = null;
document.querySelectorAll("[data-add]").forEach(function (button) {
  button.addEventListener("click", function () {
    day = button.getAttribute("data-add");
    picker.style.display = "block";
  });
});
document.querySelectorAll("[data-recipe]").forEach(function (button) {
  button.addEventListener("click", function () {
    if (window.location.search.indexOf("broken") === -1) {
      var item = document.createElement("li");
      item.textContent = button.getAttribute("data-recipe");
      document.getElementById("plan-" + day).appendChild(item);
    }
    picker.style.display = "none";
  });
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") picker.style.display = "none";
});
