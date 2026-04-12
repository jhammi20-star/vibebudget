const session = require("express-session");

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.sessions = new Map();
  }

  pruneExpired() {
    const now = Date.now();
    for (const [sid, record] of this.sessions.entries()) {
      if (record.expires <= now) {
        this.sessions.delete(sid);
      }
    }
  }

  get(sid, callback) {
    try {
      this.pruneExpired();
      const record = this.sessions.get(sid);
      callback(null, record ? JSON.parse(record.sess) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 12;

      this.sessions.set(sid, {
        sess: JSON.stringify(sess),
        expires: expiresAt,
      });

      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.sessions.delete(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

module.exports = SqliteSessionStore;
