// Opens and closes the phone menu. On wide screens the menu links are always shown.
var menuButton = document.querySelector("[data-menu-button]");
if (menuButton) {
  menuButton.addEventListener("click", function () {
    var menu = document.getElementById(menuButton.getAttribute("aria-controls"));
    var open = menu.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", open ? "true" : "false");
  });
}
