'use strict';

const { z } = require('zod');

// ─── Output schema (shared across all providers) ───────────────────────────

const AnalysisSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  feature_requests: z.array(
    z.object({
      title:      z.string().min(1),
      confidence: z.number().min(0).max(1),
    })
  ),
  actionable_insight: z.string().min(1),
});

// ─── Prompt (shared) ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a product feedback analyst.
Analyse the user feedback and respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.

The JSON must exactly match this structure:
{
  "sentiment": "positive" | "neutral" | "negative",
  "feature_requests": [
    { "title": "<string>", "confidence": <number 0.0–1.0> }
  ],
  "actionable_insight": "<string>"
}

Rules:
- sentiment must be exactly one of: positive, neutral, negative
- feature_requests is an array (may be empty)
- confidence is a float between 0 and 1
- actionable_insight is a non-empty string
- Output nothing but the JSON object`;

// Truncate to ~750 tokens to prevent context blowup
const MAX_CONTENT_CHARS = 3000;
function truncate(text) {
  return text.length <= MAX_CONTENT_CHARS
    ? text
    : text.slice(0, MAX_CONTENT_CHARS) + ' [truncated]';
}

// ─── Parse + validate (shared) ─────────────────────────────────────────────

function parseAndValidate(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`JSON parse error. Raw: ${raw.slice(0, 200)}`);
  }

  const result = AnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

// ─── Providers ─────────────────────────────────────────────────────────────

async function callOllama(content) {
  const url   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL    || 'gemma4:e4b';

  const res = await fetch(`${url}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: truncate(content) },
      ],
      stream: false,
      options: { temperature: 0.1 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data?.message?.content ?? '';
}

async function callOpenAI(content) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: truncate(content) },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callGemini(content) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  // Key passed as header instead of URL param to keep it out of logs
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: truncate(content) }] }],
      generationConfig: { temperature: 0.1 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ─── Provider registry ─────────────────────────────────────────────────────

const PROVIDERS = {
  ollama: callOllama,
  openai: callOpenAI,
  gemini: callGemini,
};

function getProvider() {
  const name = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
  const fn   = PROVIDERS[name];
  if (!fn) throw new Error(`Unknown LLM_PROVIDER "${name}". Valid options: ${Object.keys(PROVIDERS).join(', ')}`);
  return fn;
}

// ─── Public API ────────────────────────────────────────────────────────────

async function analyse(content) {
  const call = getProvider();
  const raw  = await call(content);
  try {
    const analysis = parseAndValidate(raw);
    return { raw, analysis };
  } catch (err) {
    err.raw = raw;
    throw err;
  }
}

module.exports = { analyse, parseAndValidate };
