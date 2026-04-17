'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { hashContent }      = require('../src/feedback-service');
const { parseAndValidate } = require('../src/ai-service');

// ─── hashContent ──────────────────────────────────────────────────────────────

test('hashContent: same content produces same hash', () => {
  assert.equal(hashContent('hello world'), hashContent('hello world'));
});

test('hashContent: normalises whitespace and case', () => {
  assert.equal(
    hashContent('  Hello   World  '),
    hashContent('hello world')
  );
});

test('hashContent: different content produces different hash', () => {
  assert.notEqual(hashContent('dark mode'), hashContent('light mode'));
});

// ─── parseAndValidate ─────────────────────────────────────────────────────────

const validRaw = JSON.stringify({
  sentiment: 'positive',
  feature_requests: [{ title: 'Dark mode', confidence: 0.9 }],
  actionable_insight: 'Add dark mode soon.',
});

test('parseAndValidate: accepts valid JSON', () => {
  const result = parseAndValidate(validRaw);
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.feature_requests.length, 1);
  assert.ok(result.actionable_insight);
});

test('parseAndValidate: strips markdown code fences', () => {
  const fenced = '```json\n' + validRaw + '\n```';
  const result = parseAndValidate(fenced);
  assert.equal(result.sentiment, 'positive');
});

test('parseAndValidate: throws on invalid sentiment', () => {
  const bad = JSON.stringify({ ...JSON.parse(validRaw), sentiment: 'unknown' });
  assert.throws(() => parseAndValidate(bad), /Schema validation failed/);
});

test('parseAndValidate: throws on non-JSON', () => {
  assert.throws(() => parseAndValidate('not json at all'), /JSON parse error/);
});

test('parseAndValidate: accepts empty feature_requests array', () => {
  const raw = JSON.stringify({
    sentiment: 'neutral',
    feature_requests: [],
    actionable_insight: 'Nothing to request.',
  });
  const result = parseAndValidate(raw);
  assert.deepEqual(result.feature_requests, []);
});
