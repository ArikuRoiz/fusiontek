'use strict';

const { Router } = require('express');
const svc        = require('./feedback-service');

const router = Router();

const VALID_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'];

function parsePositiveInt(val, defaultVal, max) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return defaultVal;
  return max !== undefined ? Math.min(n, max) : n;
}

// ─── POST /feedback ────────────────────────────────────────────────────────
router.post('/feedback', async (req, res, next) => {
  try {
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
  } catch (err) { next(err); }
});

// ─── GET /feedback ─────────────────────────────────────────────────────────
router.get('/feedback', async (req, res, next) => {
  try {
    const limit  = parsePositiveInt(req.query.limit,  50,  200);
    const offset = parsePositiveInt(req.query.offset, 0);
    const status = req.query.status || undefined;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const items = svc.list({ limit, offset, status });
    return res.json({ items, count: items.length, limit, offset });
  } catch (err) { next(err); }
});

// ─── GET /feedback/:id ─────────────────────────────────────────────────────
router.get('/feedback/:id', async (req, res, next) => {
  try {
    const feedback = svc.getById(req.params.id);
    if (!feedback) return res.status(404).json({ error: 'Not found' });
    return res.json(feedback);
  } catch (err) { next(err); }
});

// ─── POST /feedback/:id/retry ──────────────────────────────────────────────
router.post('/feedback/:id/retry', async (req, res, next) => {
  try {
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
  } catch (err) { next(err); }
});

module.exports = router;
