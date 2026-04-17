'use strict';

process.env.DB_PATH         = ':memory:';
process.env.LLM_PROVIDER    = 'ollama';
process.env.OLLAMA_BASE_URL = 'http://mock';
process.env.OLLAMA_MODEL    = 'mock';

// Mock fetch: 1st call returns garbage, later calls return valid JSON
let callCount = 0;
global.fetch = async () => {
  callCount++;
  const content = callCount === 1
    ? 'not json at all'
    : JSON.stringify({
        sentiment: 'positive',
        feature_requests: [],
        actionable_insight: 'ok',
      });
  return { ok: true, json: async () => ({ message: { content } }) };
};

const { test, after } = require('node:test');
const assert  = require('node:assert/strict');
const request = require('supertest');
const app     = require('../src/app');
const db      = require('../src/db');

after(() => db.closeDb());

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForStatus(id, target, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db.findById(id);
    if (row && row.status === target) return row;
    await wait(20);
  }
  throw new Error(`timeout waiting for ${target}`);
}

test('integration: RECEIVED → FAILED → retry → DONE, raw preserved on failure', async () => {
  const created = await request(app)
    .post('/feedback')
    .send({ content: 'Integration test feedback.' });
  assert.equal(created.status, 202);

  const id = created.body.id;

  const failed = await waitForStatus(id, 'FAILED');
  assert.equal(failed.raw_ai_response, 'not json at all'); // not err.message
  assert.equal(failed.analysis, null);

  const retry = await request(app).post(`/feedback/${id}/retry`);
  assert.equal(retry.status, 202);

  const done = await waitForStatus(id, 'DONE');
  const analysis = JSON.parse(done.analysis);
  assert.equal(analysis.sentiment, 'positive');
});
