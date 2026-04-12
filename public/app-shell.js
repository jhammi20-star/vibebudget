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

const inlineCategoryForms = document.querySelectorAll("[data-inline-category-form]");

inlineCategoryForms.forEach((form) => {
  const select = form.querySelector("[data-inline-category-select]");
  const status = form.querySelector("[data-inline-category-status]");

  if (!select || !status) {
    return;
  }

  let resetTimer = null;
  let isSubmittingFallback = false;

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "success";
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      status.textContent = "";
      status.dataset.state = "";
    }, 1800);
  };

  const submitFallback = () => {
    if (isSubmittingFallback) {
      return;
    }

    isSubmittingFallback = true;
    select.disabled = false;
    status.textContent = "Saving...";
    status.dataset.state = "pending";
    HTMLFormElement.prototype.submit.call(form);
  };

  select.addEventListener("change", async () => {
    const previousValue = select.dataset.previousValue || select.defaultValue || select.value;
    select.disabled = true;
    status.textContent = "Saving...";
    status.dataset.state = "pending";

    try {
      const formData = new FormData(form);
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "X-Requested-With": "fetch",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams(formData).toString(),
      });

      if (response.redirected) {
        submitFallback();
        return;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not save category");
      }

      select.dataset.previousValue = select.value;
      setStatus("Saved");
    } catch (_error) {
      select.value = previousValue;
      submitFallback();
    } finally {
      if (!isSubmittingFallback) {
        select.disabled = false;
      }
    }
  });

  select.dataset.previousValue = select.value;
});
