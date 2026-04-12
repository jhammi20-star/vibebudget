document.querySelectorAll("[data-preview-type]").forEach((select) => {
  select.addEventListener("change", (event) => {
    const row = event.target.closest(".preview-row");
    const categorySelect = row.querySelector("[data-preview-category]");
    const isTransaction = event.target.value === "transaction";
    categorySelect.disabled = !isTransaction;
    if (!isTransaction) {
      categorySelect.value = "";
    }
  });
});

