# Fusion Feedback Service

A Node.js backend that accepts free-text user feedback and asynchronously extracts structured insights using a local LLM (Ollama).

## Setup

### Prerequisites

- Node.js ≥ 18 (uses native `fetch`)
- [Ollama](https://ollama.com) running locally with `gemma4:e4b` pulled:

```bash
ollama pull gemma4:e4b
```

### Install & run

```bash
cd fusion
npm install
npm start
```

The server starts on `http://localhost:3000`.  
Configuration lives in `.env` (copy from `.env.example`).

---

## API

### Submit feedback

```
POST /feedback
Content-Type: application/json

{ "content": "I love the app but the dark mode is missing." }
```

Returns `202 Accepted` with the created feedback record.  
Returns `409 Conflict` if identical content was already submitted (deduplication).

### List feedback

```
GET /feedback
GET /feedback?status=DONE
GET /feedback?limit=20&offset=0
```

Returns `{ items, count, limit, offset }`.

### Get single item

```
GET /feedback/:id
```

### Retry failed analysis

```
POST /feedback/:id/retry
```

Only works on items with `status: FAILED`. Re-enqueues the item for analysis.

---

## State flow

```
RECEIVED → ANALYZING → DONE
                     ↘ FAILED  ── retry ──→ RECEIVED → ...
```

Submission is non-blocking: the response returns as soon as the record is persisted (`RECEIVED`). Analysis runs asynchronously in an in-process queue.

---

## Design decisions & tradeoffs

### SQLite over Postgres
SQLite with WAL mode is zero-config and sufficient for this scope. Switching to Postgres would only require changing the `db.js` driver — the rest of the code is agnostic.

### In-process queue (no BullMQ / Redis)
A simple in-memory FIFO queue with configurable concurrency (default 2) keeps the dependency footprint small. The tradeoff is that queued jobs are lost on crash. For production, a durable queue (BullMQ + Redis) would be the right call.

### Guardrail: hash-based deduplication
**Choice:** SHA-256 of normalised (trimmed, lowercased, whitespace-collapsed) content.

**Why:** Deduplication gives the best return-on-investment in this context:
- Saves LLM calls (Ollama is local but still slow)
- Makes the API idempotent — safe to retry on network errors
- Clean, deterministic, and easy to reason about
- The 409 response includes the existing record so the client gets the analysis without re-submitting

### Token-length truncation (bonus guardrail)
Content is truncated to 3,000 characters (~750 tokens) before being sent to the LLM. Product feedback rarely needs more than a few paragraphs, so signal loss is minimal while context blowup is prevented.

### Zod schema validation
AI output is validated with Zod before being stored. Invalid output marks the record `FAILED` with the raw error stored in `raw_ai_response`, which makes debugging possible without losing data.

### No dotenv dependency
`.env` is parsed with 10 lines of stdlib code to avoid an unnecessary dependency for a simple `KEY=VALUE` format.

---

## AI Collaboration Log

### Tool used
**Claude (Anthropic)** — used as the primary coding assistant throughout the session.

### Example prompts

1. **Architecture prompt:**  
   _"Design a Node.js Express service that accepts free-text feedback, persists it to SQLite, runs async LLM analysis in an in-process queue, validates the JSON output with Zod, and supports hash-based deduplication. Show the file structure and the core modules."_

2. **AI service prompt:**  
   _"Write the Ollama integration for gemma4:e4b. Use a strict system prompt that forces pure JSON output, strip markdown code fences defensively, and validate the result with this Zod schema: [schema]. Throw descriptive errors on failure."_

3. **Queue prompt:**  
   _"Implement a lightweight in-process async FIFO queue with concurrency=2. It should update the DB status to ANALYZING before calling the AI, then to DONE or FAILED after. Use setImmediate so submission never blocks."_

### Where AI output was wrong and how I corrected it

The initial AI-generated system prompt for Ollama was too verbose and included phrases like _"Here is your JSON response:"_ before the output — which caused the parser to choke on non-JSON preamble. I diagnosed this by logging the raw `message.content` from Ollama and seeing the model mirroring the chatty system prompt style.

**Fix:** I rewrote the system prompt to be terse and imperative ("respond with ONLY a valid JSON object — no markdown, no code fences, no explanation") and added a post-processing step to strip any accidental ` ```json ` fences the model might still emit. I also dropped the temperature to `0.1` to make the output more deterministic.

### What I would improve with more time

- **Durable queue:** Replace the in-process queue with BullMQ + Redis so jobs survive restarts.
- **Structured logging:** Add a logger (pino) with request IDs for traceability.
- **Retry with backoff:** The current retry is manual (API call). An automatic exponential-backoff retry inside the queue would handle transient Ollama failures.
- **Ollama health check on startup:** Verify the model is loaded before accepting traffic.
- **Integration tests:** A test suite using an in-memory SQLite instance and a mocked Ollama server to cover the full state machine.
