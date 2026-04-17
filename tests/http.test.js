'use strict';

// Use in-memory DB so tests never touch the real feedback.db
process.env.DB_PATH = ':memory:';

// Stub the queue so no Ollama calls happen during HTTP tests
const queue = require('../src/queue');  // stub enqueue before app loads
queue.enqueue = () => {};

const { test, after } = require('node:test');
const assert   = require('node:assert/strict');
const request  = require('supertest');
const app      = require('../src/app');
const db       = require('../src/db');

// Close DB after all tests so the :memory: instance is fully reset
after(() => db.closeDb());

// ─── POST /feedback ───────────────────────────────────────────────────────────

test('POST /feedback → 202 with valid content', async () => {
  const res = await request(app)
    .post('/feedback')
    .send({ content: 'Please add dark mode.' });

  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'RECEIVED');
  assert.ok(res.body.id);
});

test('POST /feedback → 400 when content is missing', async () => {
  const res = await request(app)
    .post('/feedback')
    .send({});

  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /feedback → 400 when content is empty string', async () => {
  const res = await request(app)
    .post('/feedback')
    .send({ content: '   ' });

  assert.equal(res.status, 400);
});

test('POST /feedback → 409 on duplicate content', async () => {
  const payload = { content: 'Duplicate feedback test.' };

  await request(app).post('/feedback').send(payload);
  const res = await request(app).post('/feedback').send(payload);

  assert.equal(res.status, 409);
  assert.ok(res.body.feedback); // returns the existing record
});

// ─── GET /feedback ────────────────────────────────────────────────────────────

test('GET /feedback → 200 with items array', async () => {
  const res = await request(app).get('/feedback');

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
});

// ─── GET /feedback/:id ────────────────────────────────────────────────────────

test('GET /feedback/:id → 200 for existing item', async () => {
  const created = await request(app)
    .post('/feedback')
    .send({ content: 'Fetch me by id.' });

  const res = await request(app).get(`/feedback/${created.body.id}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.id, created.body.id);
});

test('GET /feedback/:id → 404 for unknown id', async () => {
  const res = await request(app).get('/feedback/does-not-exist');

  assert.equal(res.status, 404);
});
