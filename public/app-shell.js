const menuToggle = document.querySelector("[data-menu-toggle]");
const menuDrawer = document.querySelector("[data-menu-drawer]");
const menuBackdrop = document.querySelector("[data-menu-backdrop]");
const menuClose = document.querySelector("[data-menu-close]");

if (menuToggle && menuDrawer && menuBackdrop) {
  const setMenuState = (open) => {
    menuToggle.setAttribute("aria-expanded", String(open));
    menuDrawer.setAttribute("aria-hidden", String(!open));
    menuBackdrop.hidden = !open;
    document.body.classList.toggle("drawer-open", open);
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    setMenuState(!isOpen);
  });

  menuBackdrop.addEventListener("click", () => setMenuState(false));

  if (menuClose) {
    menuClose.addEventListener("click", () => setMenuState(false));
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuState(false);
    }
  });
}
