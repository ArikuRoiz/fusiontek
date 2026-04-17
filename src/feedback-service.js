'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db    = require('./db');
const queue = require('./queue');

/**
 * Normalise content before hashing so trivial differences (casing,
 * leading/trailing whitespace) don't defeat deduplication.
 */
function hashContent(content) {
  const normalised = content.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

function formatFeedback(row) {
  if (!row) return null;
  return {
    id:         row.id,
    content:    row.content,
    status:     row.status,
    analysis:   row.analysis ? JSON.parse(row.analysis) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Submit ────────────────────────────────────────────────────────────────

function submit(content) {
  const hash = hashContent(content);

  // Guardrail: hash-based deduplication
  const existing = db.findByHash(hash);
  if (existing) {
    return { duplicate: true, feedback: formatFeedback(existing) };
  }

  const now      = new Date().toISOString();
  const feedback = {
    id:           uuidv4(),
    content,
    content_hash: hash,
    status:       'RECEIVED',
    created_at:   now,
    updated_at:   now,
  };

  db.insert(feedback);

  // Kick off async analysis — does NOT block the response
  setImmediate(() => queue.enqueue(feedback.id, feedback.content));

  return { duplicate: false, feedback: formatFeedback(feedback) };
}

// ─── Read ──────────────────────────────────────────────────────────────────

function getById(id) {
  return formatFeedback(db.findById(id));
}

function list({ limit, offset, status } = {}) {
  const rows = db.listAll({ limit, offset, status });
  return rows.map(formatFeedback);
}

// ─── Retry ────────────────────────────────────────────────────────────────

function retry(id) {
  const row = db.findById(id);
  if (!row)               return { ok: false, reason: 'not_found' };
  if (row.status !== 'FAILED') return { ok: false, reason: 'not_failed' };

  db.updateStatus(id, 'RECEIVED');
  setImmediate(() => queue.enqueue(id, row.content));

  return { ok: true };
}

module.exports = { submit, getById, list, retry, hashContent };
