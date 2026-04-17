# Usage Guide

## Prerequisites

- Node.js v22+
- [Ollama](https://ollama.com) running locally (or an OpenAI / Gemini API key)

```bash
# Pull the default model
ollama pull gemma4:e4b
```

## Installation

```bash
git clone <repo-url>
cd fusion
npm install
```

Copy the example env file and edit as needed:

```bash
cp .env.example .env
```

---

## Running the app

The backend and frontend run as **separate processes**.

### Terminal 1 — API server (port 3000)

```bash
npm start          # production
npm run dev        # with --watch (auto-restarts on file change)
```

### Terminal 2 — Frontend (port 8080)

```bash
npm run client
```

Then open **http://localhost:8080** in your browser.

### Run both at once (dev only)

```bash
npm run dev:all
```

Starts both processes with colour-coded log output.

---

## API reference

### Health check

```
GET /health
→ 200 { ok: true }
```

### Submit feedback

```
POST /feedback
Content-Type: application/json

{ "content": "I really need dark mode and better search." }
```

| Status | Meaning |
|--------|---------|
| `202` | Accepted — analysis running in background |
| `400` | Missing or empty `content` |
| `409` | Duplicate — identical content already submitted (returns existing record) |

Response body:
```json
{
  "id": "uuid",
  "content": "...",
  "status": "RECEIVED",
  "analysis": null,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

### List feedback

```
GET /feedback
GET /feedback?status=DONE
GET /feedback?limit=20&offset=0
```

Valid `status` values: `RECEIVED`, `ANALYZING`, `DONE`, `FAILED`

### Get single item

```
GET /feedback/:id
→ 200  feedback object with analysis (once DONE)
→ 404  not found
```

### Retry failed analysis

```
POST /feedback/:id/retry
→ 202  re-enqueued
→ 404  not found
→ 409  item is not in FAILED state
```

---

## Status lifecycle

```
RECEIVED → ANALYZING → DONE
                     ↘ FAILED  ── retry ──→ RECEIVED → ...
```

Poll `GET /feedback/:id` until `status` is `DONE` or `FAILED`.

---

## Analysis output shape

Once `status` is `DONE`, the `analysis` field contains:

```json
{
  "sentiment": "positive | neutral | negative",
  "feature_requests": [
    { "title": "Dark mode", "confidence": 0.95 }
  ],
  "actionable_insight": "Prioritise dark mode — high confidence request."
}
```

---

## Switching LLM provider

Edit `.env`:

```bash
# Ollama (default, local, no API key)
LLM_PROVIDER=ollama
OLLAMA_MODEL=gemma4:e4b

# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Gemini
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
```

Restart the server — no code change needed.

---

## Running tests

```bash
npm test
```

- 6 unit tests — pure logic, no server or DB
- 7 HTTP tests — real Express, in-memory SQLite, queue stubbed (no Ollama)
- All 13 tests should pass in under 200ms
