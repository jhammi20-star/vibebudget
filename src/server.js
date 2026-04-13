const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const {
  addCategory,
  addIncome,
  addTransaction,
  countTransactions,
  createInitialUsers,
  deleteIncome,
  deleteTransaction,
  findCategoryById,
  findUserByEmail,
  findUserById,
  findTransactionById,
  getOverview,
  getSpendingTimeline,
  hasUsers,
  importBankRows,
  listCategories,
  listCategoriesWithSpending,
  listIncomeEntries,
  listTransactions,
  updateCategory,
  updateTransactionCategory,
  updateTransaction,
} = require("./db");
const { buildImportPreview } = require("./importer");
const { dataDir, enableHttps, host, isProduction, port, sessionSecret } = require("./config");
const SqliteSessionStore = require("./sqlite-session-store");

const app = express();

fs.mkdirSync(dataDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many sign-in attempts. Please try again in a little while.",
});

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many import attempts. Please wait a bit and try again.",
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.set("trust proxy", 1);

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        upgradeInsecureRequests: enableHttps ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: enableHttps
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
        }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    name: "vibe.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    rolling: false,
    store: new SqliteSessionStore(),
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 12,
      sameSite: "lax",
      secure: isProduction && enableHttps,
    },
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.use((req, res, next) => {
  const user = req.session.userId ? findUserById(req.session.userId) : null;
  res.locals.currentUser = user;
  res.locals.error = req.session.error || null;
  res.locals.success = req.session.success || null;
  delete req.session.error;
  delete req.session.success;
  next();
});

function requireSetup(req, res, next) {
  if (!hasUsers()) {
    return res.redirect("/setup");
  }
  return next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.error = "Please sign in to view your budget.";
    return req.session.save(() => {
      res.redirect("/login");
    });
  }
  return next();
}

function currency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getTransactionListState(source = {}) {
  const allowedSorts = new Set([
    "newest",
    "oldest",
    "highest",
    "lowest",
    "description",
    "category",
  ]);
  const requestedPage = Number(source.transactionPage || 1);
  const transactionPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const transactionSearch = String(source.transactionSearch || "").trim();
  const requestedSort = String(source.transactionSort || "newest");
  const transactionSort = allowedSorts.has(requestedSort) ? requestedSort : "newest";
  const requestedCategoryId = Number(source.transactionCategoryId || 0);
  const transactionCategoryId =
    Number.isInteger(requestedCategoryId) && requestedCategoryId > 0 ? requestedCategoryId : null;
  return {
    transactionPage,
    transactionSearch,
    transactionSort,
    transactionCategoryId,
  };
}

function buildTransactionListQuery(state, overrides = {}) {
  const params = new URLSearchParams();
  const transactionPage = overrides.transactionPage ?? state.transactionPage;
  const transactionSearch = overrides.transactionSearch ?? state.transactionSearch;
  const transactionSort = overrides.transactionSort ?? state.transactionSort;
  const transactionCategoryId =
    overrides.transactionCategoryId ?? state.transactionCategoryId;

  if (transactionPage > 1) {
    params.set("transactionPage", String(transactionPage));
  }
  if (transactionSearch) {
    params.set("transactionSearch", transactionSearch);
  }
  if (transactionSort && transactionSort !== "newest") {
    params.set("transactionSort", transactionSort);
  }
  if (transactionCategoryId) {
    params.set("transactionCategoryId", String(transactionCategoryId));
  }

  return params.toString();
}

function getSafeRedirectTarget(value, fallback) {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }
  return candidate;
}

app.get("/", requireSetup, requireAuth, (req, res) => {
  const transactionListState = getTransactionListState(req.query);
  const pageSize = 10;
  const totalTransactions = countTransactions({
    search: transactionListState.transactionSearch,
    categoryId: transactionListState.transactionCategoryId,
  });
  const lastTransactionPage = Math.max(Math.ceil(totalTransactions / pageSize), 1);
  const transactionPage = Math.min(transactionListState.transactionPage, lastTransactionPage);
  const transactionOffset = (transactionPage - 1) * pageSize;
  const overview = getOverview();
  const categories = listCategoriesWithSpending();
  const spendingTimeline = getSpendingTimeline(8);
  const categoryOptions = listCategories();
  const transactions = listTransactions({
    limit: pageSize,
    offset: transactionOffset,
    search: transactionListState.transactionSearch,
    sort: transactionListState.transactionSort,
    categoryId: transactionListState.transactionCategoryId,
  });
  const incomeEntries = listIncomeEntries();
  const currentTransactionState = {
    ...transactionListState,
    transactionPage,
  };
  const categoryBreakdown = categories
    .slice()
    .sort((left, right) => Number(right.spent || 0) - Number(left.spent || 0));

  res.render("dashboard", {
    categoryBreakdown,
    categories,
    categoryOptions,
    incomeEntries,
    transactions,
    transactionListState: currentTransactionState,
    transactionListQuery: buildTransactionListQuery(currentTransactionState),
    transactionPage,
    hasPreviousTransactionPage: transactionPage > 1,
    hasNextTransactionPage: transactionPage < lastTransactionPage,
    transactionPageCount: lastTransactionPage,
    overview: {
      totalIncome: currency(overview.totalIncome),
      totalBudget: currency(overview.totalBudget),
      totalSpent: currency(overview.totalSpent),
      netAvailable: currency(overview.totalIncome - overview.totalSpent),
      remaining: currency(overview.totalBudget - overview.totalSpent),
      transactionCount: overview.transactionCount,
      incomeCount: overview.incomeCount,
    },
    overviewRaw: {
      totalIncome: overview.totalIncome,
      totalBudget: overview.totalBudget,
      totalSpent: overview.totalSpent,
      netAvailable: overview.totalIncome - overview.totalSpent,
      remaining: overview.totalBudget - overview.totalSpent,
      transactionCount: overview.transactionCount,
      incomeCount: overview.incomeCount,
    },
    spendingTimeline,
    today: today(),
    formatCurrency: currency,
  });
});

app.get("/categories/:id/transactions", requireSetup, requireAuth, (req, res) => {
  const category = findCategoryById(req.params.id);
  if (!category) {
    req.session.error = "That category could not be found.";
    return res.redirect("/");
  }

  const transactionListState = {
    ...getTransactionListState(req.query),
    transactionCategoryId: Number(category.id),
  };
  const pageSize = 10;
  const totalTransactions = countTransactions({
    search: transactionListState.transactionSearch,
    categoryId: transactionListState.transactionCategoryId,
  });
  const lastTransactionPage = Math.max(Math.ceil(totalTransactions / pageSize), 1);
  const transactionPage = Math.min(transactionListState.transactionPage, lastTransactionPage);
  const transactions = listTransactions({
    limit: pageSize,
    offset: (transactionPage - 1) * pageSize,
    search: transactionListState.transactionSearch,
    sort: transactionListState.transactionSort,
    categoryId: transactionListState.transactionCategoryId,
  });
  const currentTransactionState = {
    ...transactionListState,
    transactionPage,
  };

  res.render("category-transactions", {
    category,
    categoryOptions: listCategories(),
    transactions,
    transactionListState: currentTransactionState,
    transactionListQuery: buildTransactionListQuery(currentTransactionState),
    transactionPage,
    hasPreviousTransactionPage: transactionPage > 1,
    hasNextTransactionPage: transactionPage < lastTransactionPage,
    transactionPageCount: lastTransactionPage,
    formatCurrency: currency,
  });
});

app.get("/manage", requireSetup, requireAuth, (req, res) => {
  const transactionListState = getTransactionListState(req.query);
  const editingTransaction = req.query.editTransaction
    ? findTransactionById(req.query.editTransaction)
    : null;
  const editingCategory = req.query.editCategory ? findCategoryById(req.query.editCategory) : null;

  res.render("manage", {
    categoryOptions: listCategories(),
    editingCategory,
    editingTransaction,
    transactionListState,
    transactionListQuery: buildTransactionListQuery(transactionListState),
    today: today(),
  });
});

app.get("/imports/bank-csv/preview", requireAuth, (req, res) => {
  const preview = req.session.importPreview;
  if (!preview || !Array.isArray(preview.rows) || preview.rows.length === 0) {
    req.session.error = "Upload a CSV file first to review the import.";
    return res.redirect("/");
  }

  return res.render("import-preview", {
    categories: listCategories(),
    preview,
    formatCurrency: currency,
  });
});

app.get("/setup", (req, res) => {
  if (hasUsers()) {
    return res.redirect("/login");
  }
  return res.render("setup");
});

app.post("/setup", (req, res) => {
  if (hasUsers()) {
    return res.redirect("/login");
  }

  const users = [
    {
      name: req.body.name1,
      email: req.body.email1,
      password: req.body.password1,
    },
    {
      name: req.body.name2,
      email: req.body.email2,
      password: req.body.password2,
    },
  ];

  const missingField = users.some((user) => !user.name || !user.email || !user.password);
  const duplicateEmails =
    users[0].email.trim().toLowerCase() === users[1].email.trim().toLowerCase();

  if (missingField || duplicateEmails) {
    req.session.error =
      "Enter a name, email, and password for both people, using two different email addresses.";
    return res.redirect("/setup");
  }

  try {
    createInitialUsers(users);
    req.session.success = "Accounts created. Sign in to start tracking your shared budget.";
    return res.redirect("/login");
  } catch (error) {
    req.session.error = error.message || "Could not complete setup.";
    return res.redirect("/setup");
  }
});

app.get("/login", requireSetup, (req, res) => {
  if (req.session.userId) {
    return res.redirect("/");
  }
  return res.render("login");
});

app.post("/login", requireSetup, authLimiter, (req, res) => {
  const email = req.body.email || "";
  const password = req.body.password || "";
  const user = findUserByEmail(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.error = "That email or password did not match.";
    return req.session.save(() => {
      res.redirect("/login");
    });
  }

  req.session.userId = user.id;
  req.session.success = `Welcome back, ${user.name}.`;
  return req.session.save(() => {
    res.redirect("/");
  });
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.post("/categories", requireAuth, (req, res) => {
  try {
    addCategory(req.body.name || "", req.body.monthlyBudget || 0);
    req.session.success = "Category added.";
  } catch (error) {
    req.session.error = "Could not add that category. It may already exist.";
  }
  res.redirect("/manage");
});

app.post("/categories/:id/update", requireAuth, (req, res) => {
  try {
    updateCategory(req.params.id, req.body.name || "", req.body.monthlyBudget || 0);
    req.session.success = "Category updated.";
  } catch (error) {
    req.session.error = "Could not update that category. It may already exist.";
  }
  res.redirect("/manage");
});

app.post("/transactions", requireAuth, (req, res) => {
  try {
    addTransaction({
      categoryId: req.body.categoryId,
      description: req.body.description || "",
      amount: req.body.amount || 0,
      transactionDate: req.body.transactionDate || today(),
      createdBy: req.session.userId,
    });
    req.session.success = "Transaction saved.";
  } catch (error) {
    req.session.error = "Could not save that transaction.";
  }
  res.redirect("/manage");
});

app.post("/transactions/:id/update", requireAuth, (req, res) => {
  const transactionListState = getTransactionListState(req.body);
  const fallbackRedirect = (() => {
    const query = buildTransactionListQuery(transactionListState);
    return query ? `/manage?${query}` : "/manage";
  })();
  try {
    updateTransaction({
      id: req.params.id,
      categoryId: req.body.categoryId,
      description: req.body.description || "",
      amount: req.body.amount || 0,
      transactionDate: req.body.transactionDate || today(),
    });
    req.session.success = "Transaction updated.";
  } catch (error) {
    req.session.error = "Could not update that transaction.";
  }
  res.redirect(getSafeRedirectTarget(req.body.redirectTo, fallbackRedirect));
});

app.post("/transactions/:id/category", requireAuth, (req, res) => {
  const transactionListState = getTransactionListState(req.body);
  try {
    const existingTransaction = findTransactionById(req.params.id);
    if (!existingTransaction) {
      throw new Error("Missing transaction");
    }

    const categoryId = Number(req.body.categoryId);
    const validCategory = findCategoryById(categoryId);
    if (!validCategory) {
      throw new Error("Invalid category");
    }

    updateTransactionCategory(req.params.id, categoryId);

    if (req.get("x-requested-with") === "fetch") {
      return res.status(200).json({
        ok: true,
        categoryId,
        categoryName: validCategory.name,
      });
    }

    req.session.success = "Category updated.";
  } catch (error) {
    if (req.get("x-requested-with") === "fetch") {
      return res.status(400).json({
        ok: false,
        error: "Could not update that transaction category.",
      });
    }
    req.session.error = "Could not update that transaction category.";
  }
  const fallbackRedirect = (() => {
    const query = buildTransactionListQuery(transactionListState);
    return query ? `/?${query}` : "/";
  })();
  res.redirect(getSafeRedirectTarget(req.body.redirectTo, fallbackRedirect));
});

app.post("/income", requireAuth, (req, res) => {
  try {
    addIncome({
      source: req.body.source || "",
      amount: req.body.amount || 0,
      receivedDate: req.body.receivedDate || today(),
      createdBy: req.session.userId,
    });
    req.session.success = "Income saved.";
  } catch (error) {
    req.session.error = "Could not save that income entry.";
  }
  res.redirect("/manage");
});

app.post("/imports/bank-csv", requireAuth, importLimiter, upload.single("bankCsv"), (req, res) => {
  if (!req.file) {
    req.session.error = "Choose a CSV file from your bank to import.";
    return res.redirect("/manage");
  }

  try {
    const rows = buildImportPreview(req.file.buffer, listCategories());

    if (rows.length === 0) {
      req.session.error = "No usable transactions were found in that CSV file.";
      return res.redirect("/manage");
    }
    req.session.importPreview = {
      fileName: req.file.originalname,
      rows,
    };
  } catch (error) {
    req.session.error = error.message || "Could not import that CSV file.";
    return res.redirect("/manage");
  }

  return res.redirect("/imports/bank-csv/preview");
});

app.post("/imports/bank-csv/confirm", requireAuth, (req, res) => {
  const preview = req.session.importPreview;
  if (!preview || !Array.isArray(preview.rows) || preview.rows.length === 0) {
    req.session.error = "Upload a CSV file first to review the import.";
    return res.redirect("/");
  }

  const categories = listCategories();
  const validCategoryIds = new Set(categories.map((category) => Number(category.id)));
  const submittedRows = Array.isArray(req.body.rows) ? req.body.rows : [];
  let invalidTransactionRows = 0;
  const approvedRows = preview.rows
    .map((originalRow, index) => {
      const submittedRow = submittedRows[index] || {};
      const type =
        submittedRow.type === "income" ||
        submittedRow.type === "transaction" ||
        submittedRow.type === "ignore"
          ? submittedRow.type
          : originalRow.type;

      const normalizedRow = {
        type,
        description: originalRow.description,
        amount: Number(originalRow.amount),
        date: originalRow.date,
        fingerprint: originalRow.fingerprint,
      };

      if (type !== "transaction") {
        return normalizedRow;
      }

      const categoryId = Number(submittedRow.categoryId);
      if (!validCategoryIds.has(categoryId)) {
        invalidTransactionRows += 1;
        return null;
      }

      return {
        ...normalizedRow,
        categoryId,
      };
    })
    .filter(Boolean)
    .filter((row) => row.description && row.date && row.amount > 0);

  if (invalidTransactionRows > 0) {
    req.session.error =
      "One or more expense rows are missing a valid category. Please review them and try again.";
    return res.redirect("/imports/bank-csv/preview");
  }

  if (approvedRows.length === 0) {
    req.session.error = "There were no valid rows to import.";
    return res.redirect("/imports/bank-csv/preview");
  }

  const rowsToImport = approvedRows.filter((row) => row.type !== "ignore");
  if (rowsToImport.length === 0) {
    req.session.error = "Every row is currently set to ignore.";
    return res.redirect("/imports/bank-csv/preview");
  }

  let summary;
  try {
    summary = importBankRows({
      rows: rowsToImport,
      createdBy: req.session.userId,
    });
  } catch (error) {
    req.session.error =
      "One or more selected rows had an invalid category. Please review them and try again.";
    return res.redirect("/imports/bank-csv/preview");
  }

  delete req.session.importPreview;
  req.session.success =
    `Imported ${summary.importedIncome} income entries and ` +
    `${summary.importedTransactions} transactions. ` +
    `${summary.skippedDuplicates} duplicates were skipped.`;
  return res.redirect("/");
});

app.post("/imports/bank-csv/cancel", requireAuth, (req, res) => {
  delete req.session.importPreview;
  req.session.success = "Import preview cleared.";
  return res.redirect("/manage");
});

app.post("/transactions/:id/delete", requireAuth, (req, res) => {
  const transactionListState = getTransactionListState(req.body);
  deleteTransaction(req.params.id);
  req.session.success = "Transaction removed.";
  const fallbackRedirect = (() => {
    const query = buildTransactionListQuery(transactionListState);
    return query ? `/?${query}` : "/";
  })();
  res.redirect(getSafeRedirectTarget(req.body.redirectTo, fallbackRedirect));
});

app.post("/income/:id/delete", requireAuth, (req, res) => {
  deleteIncome(req.params.id);
  req.session.success = "Income entry removed.";
  res.redirect("/");
});

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`Budget app running at http://${host}:${port}`);
  });
}

module.exports = app;
