'use strict';

const { Router } = require('express');
const svc        = require('./feedback-service');

const router = Router();

// ─── POST /feedback ────────────────────────────────────────────────────────
router.post('/feedback', (req, res) => {
  const content = req.body?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'content is required and must be a non-empty string' });
  }

  const { duplicate, feedback } = svc.submit(content.trim());

  if (duplicate) {
    return res.status(409).json({
      error:    'Duplicate feedback — identical content already submitted',
      feedback,
    });
  }

  return res.status(202).json(feedback);
});

// ─── GET /feedback ─────────────────────────────────────────────────────────
router.get('/feedback', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10), 200);
  const offset = parseInt(req.query.offset ?? '0', 10);
  const status = req.query.status || undefined;

  const VALID_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const items = svc.list({ limit, offset, status });
  return res.json({ items, count: items.length, limit, offset });
});

// ─── GET /feedback/:id ─────────────────────────────────────────────────────
router.get('/feedback/:id', (req, res) => {
  const feedback = svc.getById(req.params.id);
  if (!feedback) return res.status(404).json({ error: 'Not found' });
  return res.json(feedback);
});

// ─── POST /feedback/:id/retry ──────────────────────────────────────────────
router.post('/feedback/:id/retry', (req, res) => {
  const result = svc.retry(req.params.id);

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    const msg    = result.reason === 'not_found'
      ? 'Feedback not found'
      : 'Only FAILED feedback can be retried';
    return res.status(status).json({ error: msg });
  }

  const feedback = svc.getById(req.params.id);
  return res.status(202).json(feedback);
});

module.exports = router;
