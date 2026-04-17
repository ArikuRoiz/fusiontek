'use strict';

/**
 * Simple in-process async FIFO queue with configurable concurrency.
 *
 * Tradeoff: in-process means jobs are lost on crash. For this scope that's
 * acceptable — a production system would use a durable queue (BullMQ, etc.).
 * The queue exposes a retry path so callers can re-enqueue FAILED items.
 */

const db        = require('./db');
const aiService = require('./ai-service');

const CONCURRENCY = 2; // process up to 2 feedback items in parallel

let active = 0;
const pending = [];   // { id, content }[]

function enqueue(id, content) {
  pending.push({ id, content });
  drain();
}

function drain() {
  while (active < CONCURRENCY && pending.length > 0) {
    const job = pending.shift();
    active++;
    process(job).finally(() => {
      active--;
      drain();
    });
  }
}

async function process({ id, content }) {
  db.updateStatus(id, 'ANALYZING');

  try {
    const { raw, analysis } = await aiService.analyse(content);

    db.updateAnalysis(id, {
      status:          'DONE',
      raw_ai_response: raw,
      analysis:        JSON.stringify(analysis),
    });
  } catch (err) {
    console.error(`[queue] analysis failed for ${id}:`, err.message);

    db.updateAnalysis(id, {
      status:          'FAILED',
      raw_ai_response: err.message,
      analysis:        null,
    });
  }
}

module.exports = { enqueue };
