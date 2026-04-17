'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const _rawPath = process.env.DB_PATH || '';
const DB_PATH  = _rawPath === ':memory:'
  ? ':memory:'
  : path.resolve(_rawPath || path.join(__dirname, '..', 'feedback.db'));

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id           TEXT PRIMARY KEY,
      content      TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      status       TEXT NOT NULL DEFAULT 'RECEIVED'
                        CHECK(status IN ('RECEIVED','ANALYZING','DONE','FAILED')),
      raw_ai_response TEXT,
      analysis        TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);
}

// ─── Prepared statements ───────────────────────────────────────────────────

const stmts = {};

function stmt(name, sql) {
  if (!stmts[name]) stmts[name] = getDb().prepare(sql);
  return stmts[name];
}

function insert(feedback) {
  return stmt('insert', `
    INSERT INTO feedback (id, content, content_hash, status, created_at, updated_at)
    VALUES (@id, @content, @content_hash, @status, @created_at, @updated_at)
  `).run(feedback);
}

function findByHash(hash) {
  return stmt('findByHash', `
    SELECT * FROM feedback WHERE content_hash = ?
  `).get(hash);
}

function findById(id) {
  return stmt('findById', `
    SELECT * FROM feedback WHERE id = ?
  `).get(id);
}

function listAll({ limit = 50, offset = 0, status } = {}) {
  if (status) {
    return getDb().prepare(`
      SELECT * FROM feedback WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
  }
  return getDb().prepare(`
    SELECT * FROM feedback ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function updateStatus(id, status) {
  return getDb().prepare(`
    UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?
  `).run(status, new Date().toISOString(), id);
}

function updateAnalysis(id, { status, raw_ai_response, analysis }) {
  return getDb().prepare(`
    UPDATE feedback
    SET status = ?, raw_ai_response = ?, analysis = ?, updated_at = ?
    WHERE id = ?
  `).run(status, raw_ai_response, analysis, new Date().toISOString(), id);
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  getDb,
  closeDb,
  insert,
  findByHash,
  findById,
  listAll,
  updateStatus,
  updateAnalysis,
};
