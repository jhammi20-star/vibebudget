const path = require("path");

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const sessionSecret = process.env.SESSION_SECRET || "";
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const sessionsDbPath = process.env.SESSIONS_DB_PATH || path.join(dataDir, "sessions.sqlite");
const enableHttps = process.env.ENABLE_HTTPS === "true";

if (isProduction && !sessionSecret) {
  throw new Error("SESSION_SECRET is required in production.");
}

module.exports = {
  dataDir,
  host,
  enableHttps,
  isProduction,
  port,
  sessionSecret: sessionSecret || "development-session-secret",
  sessionsDbPath,
};
