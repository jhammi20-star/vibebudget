const crypto = require("crypto");

const columnAliases = {
  date: ["date", "posted date", "transaction date", "posting date", "effective date"],
  description: ["description", "merchant", "details", "memo", "name", "transaction"],
  amount: ["amount"],
  debit: ["debit", "withdrawal", "withdrawals", "money out"],
  credit: ["credit", "deposit", "deposits", "money in"],
  classification: ["classification", "category", "type"],
};

const categoryRules = [
  { category: "Housing", keywords: ["rent", "mortgage", "apartment", "property management"] },
  { category: "Groceries", keywords: ["grocery", "whole foods", "trader joe", "aldi", "kroger", "publix", "costco", "safeway", "food lion"] },
  { category: "Transportation", keywords: ["uber", "lyft", "shell", "exxon", "bp", "chevron", "sunoco", "parking", "toll", "metro", "amtrak"] },
  { category: "Utilities", keywords: ["electric", "water", "gas bill", "internet", "comcast", "verizon", "at&t", "att", "t-mobile"] },
  { category: "Entertainment", keywords: ["netflix", "spotify", "hulu", "cinema", "movie", "concert", "steam", "disney"] },
  { category: "Savings", keywords: ["savings", "transfer to savings", "brokerage", "roth", "investment"] },
];

const incomeKeywords = [
  "payroll",
  "salary",
  "paycheck",
  "direct deposit",
  "deposit",
  "refund",
  "interest",
  "bonus",
  "venmo cashout",
  "zelle",
];

const ignoredClassifications = new Set([
  "transfer",
  "credit card payment",
]);

const classificationCategoryMap = {
  "mortgage & rent": "Housing",
  utilities: "Utilities",
  income: "Income",
  "auto payment": "Transportation",
  financial: "Savings",
  check: "Housing",
};

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase();
}

function findColumnIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  const normalized = String(raw)
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\(/g, "-")
    .replace(/\)/g, "")
    .trim();

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function toIsoDate(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    return null;
  }

  let [, month, day, year] = match;
  if (year.length === 2) {
    year = `20${year}`;
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function categorizeDescription(description, categories, classification) {
  const normalizedClassification = String(classification || "").trim().toLowerCase();
  const mappedCategoryName = classificationCategoryMap[normalizedClassification];
  if (mappedCategoryName && mappedCategoryName !== "Income") {
    const mappedCategory = categories.find((entry) => entry.name === mappedCategoryName);
    if (mappedCategory) {
      return mappedCategory;
    }
  }

  const normalized = description.toLowerCase();

  for (const rule of categoryRules) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      const category = categories.find((entry) => entry.name === rule.category);
      if (category) {
        return category;
      }
    }
  }

  return categories.find((entry) => entry.name === "Entertainment") || categories[0];
}

function isIncome(description, amount, hasCreditColumn) {
  const normalized = description.toLowerCase();
  if (incomeKeywords.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  return hasCreditColumn && amount > 0;
}

function shouldIgnoreRow(description, classification) {
  const normalizedDescription = description.toLowerCase();
  const normalizedClassification = String(classification || "").trim().toLowerCase();

  if (ignoredClassifications.has(normalizedClassification)) {
    return true;
  }

  return (
    normalizedDescription.includes("transfer from") ||
    normalizedDescription.includes("funds transfer") ||
    normalizedDescription.includes("zelle transfer") ||
    normalizedDescription.includes("transfer to venmo") ||
    normalizedDescription.includes("brokerage services")
  );
}

function isIncomeRow(description, amount, hasCreditColumn, classification) {
  const normalizedClassification = String(classification || "").trim().toLowerCase();
  if (normalizedClassification === "income") {
    return true;
  }

  return isIncome(description, amount, hasCreditColumn);
}

function makeFingerprint(entry) {
  return crypto
    .createHash("sha256")
    .update(`${entry.type}|${entry.date}|${entry.description}|${entry.amount.toFixed(2)}`)
    .digest("hex");
}

function buildImportPreview(csvBuffer, categories) {
  const csvText = csvBuffer.toString("utf8");
  const parsed = parseCsv(csvText);

  if (parsed.length < 2) {
    throw new Error("The CSV needs a header row and at least one transaction row.");
  }

  const headers = parsed[0];
  const dateIndex = findColumnIndex(headers, columnAliases.date);
  const descriptionIndex = findColumnIndex(headers, columnAliases.description);
  const amountIndex = findColumnIndex(headers, columnAliases.amount);
  const debitIndex = findColumnIndex(headers, columnAliases.debit);
  const creditIndex = findColumnIndex(headers, columnAliases.credit);
  const classificationIndex = findColumnIndex(headers, columnAliases.classification);

  if (dateIndex === -1 || descriptionIndex === -1) {
    throw new Error("Could not find date and description columns in that CSV export.");
  }

  if (amountIndex === -1 && debitIndex === -1 && creditIndex === -1) {
    throw new Error("Could not find an amount, debit, or credit column in that CSV export.");
  }

  const rows = [];

  for (const csvRow of parsed.slice(1)) {
    const date = toIsoDate(csvRow[dateIndex]);
    const description = String(csvRow[descriptionIndex] || "").trim();
    const classification =
      classificationIndex === -1 ? "" : String(csvRow[classificationIndex] || "");
    const amount =
      amountIndex !== -1
        ? parseAmount(csvRow[amountIndex])
        : (parseAmount(csvRow[creditIndex]) || 0) - (parseAmount(csvRow[debitIndex]) || 0);

    if (!date || !description || !amount) {
      continue;
    }

    const previewRow = {
      date,
      description,
      amount: Math.abs(amount),
      classification: classification.trim(),
      type: "transaction",
      categoryId: "",
    };

    if (shouldIgnoreRow(description, classification)) {
      previewRow.type = "ignore";
      previewRow.fingerprint = makeFingerprint({
        type: "ignore",
        date,
        description,
        amount: Math.abs(amount),
      });
      rows.push(previewRow);
      continue;
    }

    if (isIncomeRow(description, amount, creditIndex !== -1, classification)) {
      previewRow.type = "income";
      previewRow.fingerprint = makeFingerprint({
        type: "income",
        date,
        description,
        amount: Math.abs(amount),
      });
      rows.push(previewRow);
      continue;
    }

    const matchedCategory = categorizeDescription(description, categories, classification);
    previewRow.categoryId = String(matchedCategory.id);
    previewRow.categoryName = matchedCategory.name;
    previewRow.fingerprint = makeFingerprint({
      type: "transaction",
      date,
      description,
      amount: Math.abs(amount),
    });
    rows.push(previewRow);
  }

  return rows;
}

module.exports = {
  buildImportPreview,
};
