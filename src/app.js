'use strict';

// Load env vars from .env if present (no dotenv dependency — keep it lean)
const fs   = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) {
        process.env[key.trim()] ??= rest.join('=').trim();
      }
    });
}

const express = require('express');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '64kb' }));

// CORS — allow the frontend dev server on any localhost port
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Feedback routes
app.use('/', routes);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Feedback service listening on http://localhost:${PORT}`);
    console.log(`Ollama: ${process.env.OLLAMA_BASE_URL} / model: ${process.env.OLLAMA_MODEL}`);
  });
}

module.exports = app;
