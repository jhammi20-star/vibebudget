const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { dataDir } = require("./config");

fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, "budget.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    monthly_budget REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_date TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS income_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    amount REAL NOT NULL,
    received_date TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS import_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    entry_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultCategories = [
  { name: "Housing", monthlyBudget: 1800 },
  { name: "Groceries", monthlyBudget: 700 },
  { name: "Transportation", monthlyBudget: 450 },
  { name: "Utilities", monthlyBudget: 350 },
  { name: "Entertainment", monthlyBudget: 250 },
  { name: "Savings", monthlyBudget: 900 },
];

const insertCategory = db.prepare(`
  INSERT INTO categories (name, monthly_budget)
  VALUES (@name, @monthlyBudget)
`);

const insertImportFingerprint = db.prepare(`
  INSERT INTO import_fingerprints (fingerprint, entry_type)
  VALUES (?, ?)
`);

function seedCategories() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
  if (count > 0) {
    return;
  }

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertCategory.run(item);
    }
  });

  insertMany(defaultCategories);
}

function hasUsers() {
  return db.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0;
}

function createInitialUsers(users) {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES (@name, @email, @passwordHash)
  `);

  const createUsers = db.transaction((entries) => {
    if (hasUsers()) {
      throw new Error("Users have already been created.");
    }

    for (const entry of entries) {
      const passwordHash = bcrypt.hashSync(entry.password, 10);
      insertUser.run({
        name: entry.name.trim(),
        email: entry.email.trim().toLowerCase(),
        passwordHash,
      });
    }

    seedCategories();
  });

  createUsers(users);
}

function findUserByEmail(email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase());
}

function findUserById(id) {
  return db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(id);
}

function listCategoriesWithSpending() {
  return db
    .prepare(`
      SELECT
        c.id,
        c.name,
        c.monthly_budget AS monthlyBudget,
        COALESCE(SUM(t.amount), 0) AS spent
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    .all();
}

function listCategories() {
  return db
    .prepare(`
      SELECT id, name, monthly_budget AS monthlyBudget
      FROM categories
      ORDER BY name ASC
    `)
    .all();
}

function findCategoryById(id) {
  return db
    .prepare(`
      SELECT id, name, monthly_budget AS monthlyBudget
      FROM categories
      WHERE id = ?
    `)
    .get(Number(id));
}

function addCategory(name, monthlyBudget) {
  db.prepare(`
    INSERT INTO categories (name, monthly_budget)
    VALUES (?, ?)
  `).run(name.trim(), Number(monthlyBudget) || 0);
}

function updateCategory(id, name, monthlyBudget) {
  db.prepare(`
    UPDATE categories
    SET name = ?, monthly_budget = ?
    WHERE id = ?
  `).run(name.trim(), Number(monthlyBudget) || 0, Number(id));
}

function addTransaction({ categoryId, description, amount, transactionDate, createdBy }) {
  db.prepare(`
    INSERT INTO transactions (category_id, description, amount, transaction_date, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    Number(categoryId),
    description.trim(),
    Number(amount),
    transactionDate,
    Number(createdBy),
  );
}

function addIncome({ source, amount, receivedDate, createdBy }) {
  db.prepare(`
    INSERT INTO income_entries (source, amount, received_date, created_by)
    VALUES (?, ?, ?, ?)
  `).run(source.trim(), Number(amount), receivedDate, Number(createdBy));
}

function deleteTransaction(id) {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(Number(id));
}

function findTransactionById(id) {
  return db
    .prepare(`
      SELECT
        id,
        category_id AS categoryId,
        description,
        amount,
        transaction_date AS transactionDate
      FROM transactions
      WHERE id = ?
    `)
    .get(Number(id));
}

function updateTransaction({ id, categoryId, description, amount, transactionDate }) {
  db.prepare(`
    UPDATE transactions
    SET category_id = ?, description = ?, amount = ?, transaction_date = ?
    WHERE id = ?
  `).run(
    Number(categoryId),
    description.trim(),
    Number(amount),
    transactionDate,
    Number(id),
  );
}

function updateTransactionCategory(id, categoryId) {
  db.prepare(`
    UPDATE transactions
    SET category_id = ?
    WHERE id = ?
  `).run(Number(categoryId), Number(id));
}

function deleteIncome(id) {
  db.prepare("DELETE FROM income_entries WHERE id = ?").run(Number(id));
}

const transactionSorts = {
  newest: "t.transaction_date DESC, t.id DESC",
  oldest: "t.transaction_date ASC, t.id ASC",
  highest: "t.amount DESC, t.id DESC",
  lowest: "t.amount ASC, t.id ASC",
  description: "t.description COLLATE NOCASE ASC, t.id DESC",
  category: "c.name COLLATE NOCASE ASC, t.id DESC",
};

function buildTransactionFilters(search) {
  const normalizedSearch = String(search || "").trim();
  if (!normalizedSearch) {
    return {
      params: [],
      whereClause: "",
    };
  }

  const pattern = `%${normalizedSearch}%`;
  return {
    params: [pattern, pattern, pattern, pattern],
    whereClause: `
      WHERE
        t.description LIKE ? COLLATE NOCASE OR
        c.name LIKE ? COLLATE NOCASE OR
        u.name LIKE ? COLLATE NOCASE OR
        t.transaction_date LIKE ?
    `,
  };
}

function listTransactions({ limit, offset, search, sort } = {}) {
  const normalizedLimit =
    Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
  const normalizedOffset =
    Number.isInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
  const orderBy = transactionSorts[sort] || transactionSorts.newest;
  const filters = buildTransactionFilters(search);
  const query = `
      SELECT
        t.id,
        t.category_id AS categoryId,
        t.description,
        t.amount,
        t.transaction_date AS transactionDate,
        c.name AS categoryName,
        u.name AS createdByName
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.created_by
      ${filters.whereClause}
      ORDER BY ${orderBy}
  `;

  if (!normalizedLimit) {
    return db.prepare(query).all(...filters.params);
  }

  return db
    .prepare(`${query} LIMIT ? OFFSET ?`)
    .all(...filters.params, normalizedLimit, normalizedOffset);
}

function countTransactions({ search } = {}) {
  const filters = buildTransactionFilters(search);
  return db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.created_by
      ${filters.whereClause}
    `)
    .get(...filters.params).count;
}

function listIncomeEntries() {
  return db
    .prepare(`
      SELECT
        i.id,
        i.source,
        i.amount,
        i.received_date AS receivedDate,
        u.name AS createdByName
      FROM income_entries i
      JOIN users u ON u.id = i.created_by
      ORDER BY i.received_date DESC, i.id DESC
    `)
    .all();
}

function getOverview() {
  return db
    .prepare(`
      SELECT
        COALESCE(SUM(monthly_budget), 0) AS totalBudget,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM income_entries
        ) AS totalIncome,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM transactions
        ) AS totalSpent,
        (
          SELECT COUNT(*)
          FROM transactions
        ) AS transactionCount,
        (
          SELECT COUNT(*)
          FROM income_entries
        ) AS incomeCount
      FROM categories
    `)
    .get();
}

function getSpendingTimeline(days = 8) {
  const safeDays = Math.max(Number(days) || 8, 1);
  const latestRow = db
    .prepare(`
      SELECT COALESCE(MAX(transaction_date), DATE('now')) AS latestDate
      FROM transactions
    `)
    .get();

  const endDate = new Date(`${latestRow.latestDate}T00:00:00`);
  const dates = [];

  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - index);
    dates.push(date.toISOString().slice(0, 10));
  }

  const totals = db
    .prepare(`
      SELECT
        transaction_date AS transactionDate,
        COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ?
      GROUP BY transaction_date
      ORDER BY transaction_date ASC
    `)
    .all(dates[0], dates[dates.length - 1]);

  const totalsByDate = new Map(
    totals.map((row) => [row.transactionDate, Number(row.total) || 0]),
  );

  return dates.map((date) => ({
    date,
    total: totalsByDate.get(date) || 0,
    shortLabel: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
      new Date(`${date}T00:00:00`),
    ),
  }));
}

function importBankRows({ rows, createdBy }) {
  const insertTransaction = db.prepare(`
    INSERT INTO transactions (category_id, description, amount, transaction_date, created_by)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertIncomeEntry = db.prepare(`
    INSERT INTO income_entries (source, amount, received_date, created_by)
    VALUES (?, ?, ?, ?)
  `);

  const summary = {
    importedTransactions: 0,
    importedIncome: 0,
    skippedDuplicates: 0,
  };

  const runImport = db.transaction((entries) => {
    for (const entry of entries) {
      try {
        insertImportFingerprint.run(entry.fingerprint, entry.type);
      } catch (error) {
        if (String(error.message).includes("UNIQUE")) {
          summary.skippedDuplicates += 1;
          continue;
        }
        throw error;
      }

      if (entry.type === "income") {
        insertIncomeEntry.run(entry.description, entry.amount, entry.date, Number(createdBy));
        summary.importedIncome += 1;
        continue;
      }

      insertTransaction.run(
        Number(entry.categoryId),
        entry.description,
        entry.amount,
        entry.date,
        Number(createdBy),
      );
      summary.importedTransactions += 1;
    }
  });

  runImport(rows);
  return summary;
}

module.exports = {
  addCategory,
  addIncome,
  addTransaction,
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
  countTransactions,
  listCategories,
  listCategoriesWithSpending,
  listIncomeEntries,
  listTransactions,
  updateCategory,
  updateTransactionCategory,
  updateTransaction,
};
