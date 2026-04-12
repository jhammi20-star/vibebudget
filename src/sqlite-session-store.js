const fs = require("fs");
const path = require("path");
const session = require("express-session");
const Database = require("better-sqlite3");
const { sessionsDbPath } = require("./config");

fs.mkdirSync(path.dirname(sessionsDbPath), { recursive: true });

function isRecoverableSqliteError(error) {
  return (
    error &&
    (
      error.code === "SQLITE_NOTADB" ||
      error.code === "SQLITE_CORRUPT" ||
      error.code === "SQLITE_IOERR" ||
      String(error.message || "").includes("database connection is not open")
    )
  );
}

function initializeDatabase(filePath) {
  const database = new Database(filePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
  `);

  return {
    db: database,
    getSession: database.prepare(`
      SELECT sess
      FROM sessions
      WHERE sid = ? AND expires > ?
    `),
    upsertSession: database.prepare(`
      INSERT INTO sessions (sid, sess, expires)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        sess = excluded.sess,
        expires = excluded.expires
    `),
    deleteSession: database.prepare(`
      DELETE FROM sessions
      WHERE sid = ?
    `),
    cleanupSessions: database.prepare(`
      DELETE FROM sessions
      WHERE expires <= ?
    `),
  };
}

function quarantineSessionsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const invalidPath = `${filePath}.invalid-${Date.now()}`;
  fs.renameSync(filePath, invalidPath);
}

function createMemoryState() {
  return {
    kind: "memory",
    sessions: new Map(),
  };
}

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.state = this.openState();
  }

  openState() {
    try {
      return {
        kind: "sqlite",
        ...initializeDatabase(sessionsDbPath),
      };
    } catch (error) {
      if (!isRecoverableSqliteError(error)) {
        throw error;
      }

      try {
        quarantineSessionsFile(sessionsDbPath);
        return {
          kind: "sqlite",
          ...initializeDatabase(sessionsDbPath),
        };
      } catch (retryError) {
        if (!isRecoverableSqliteError(retryError)) {
          throw retryError;
        }
        return createMemoryState();
      }
    }
  }

  recoverState(error) {
    if (!isRecoverableSqliteError(error)) {
      throw error;
    }

    try {
      this.state?.db?.close();
    } catch (_closeError) {
      // Ignore close failures while recovering a broken session database.
    }

    try {
      quarantineSessionsFile(sessionsDbPath);
      this.state = {
        kind: "sqlite",
        ...initializeDatabase(sessionsDbPath),
      };
    } catch (retryError) {
      if (!isRecoverableSqliteError(retryError)) {
        throw retryError;
      }
      this.state = createMemoryState();
    }
  }

  withRecovery(callback, done) {
    try {
      return callback();
    } catch (error) {
      try {
        this.recoverState(error);
        return callback();
      } catch (retryError) {
        done(retryError);
        return null;
      }
    }
  }

  get(sid, callback) {
    this.withRecovery(() => {
      if (this.state.kind === "memory") {
        const record = this.state.sessions.get(sid);
        if (!record || record.expires <= Date.now()) {
          this.state.sessions.delete(sid);
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(record.sess));
        return;
      }

      this.state.cleanupSessions.run(Date.now());
      const row = this.state.getSession.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    }, callback);
  }

  set(sid, sess, callback) {
    this.withRecovery(() => {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 12;

      if (this.state.kind === "memory") {
        this.state.sessions.set(sid, {
          sess: JSON.stringify(sess),
          expires: expiresAt,
        });
        callback?.(null);
        return;
      }

      this.state.upsertSession.run(sid, JSON.stringify(sess), expiresAt);
      callback?.(null);
    }, callback || (() => {}));
  }

  destroy(sid, callback) {
    this.withRecovery(() => {
      if (this.state.kind === "memory") {
        this.state.sessions.delete(sid);
        callback?.(null);
        return;
      }

      this.state.deleteSession.run(sid);
      callback?.(null);
    }, callback || (() => {}));
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

module.exports = SqliteSessionStore;
