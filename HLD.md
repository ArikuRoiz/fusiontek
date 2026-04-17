# High-Level Design — Fusion Feedback Service

## Overview

A backend service that accepts free-text user feedback, persists it to a local SQLite database, and asynchronously enriches each item with structured AI-generated insights via a locally running LLM (Ollama). The system is intentionally small and dependency-light to fit a 3-hour build window.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (HTTP)                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /feedback
                           │ GET  /feedback[/:id]
                           │ POST /feedback/:id/retry
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express HTTP Server                          │
│                        src/routes.js                            │
│                                                                 │
│  • Input validation (content required, non-empty)              │
│  • Maps HTTP verbs → FeedbackService calls                     │
│  • Returns 202 Accepted (non-blocking submit)                  │
│  • Returns 409 Conflict on duplicate content                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FeedbackService                               │
│                  src/feedbackService.js                         │
│                                                                 │
│  • SHA-256 deduplication (normalise → hash → lookup)           │
│  • UUID assignment + timestamp management                       │
│  • Calls db.insert(), db.findByHash(), db.listAll()            │
│  • Enqueues analysis via setImmediate (non-blocking)           │
└──────────┬────────────────────────────┬────────────────────────┘
           │ sync (DB)                  │ async (queue)
           ▼                            ▼
┌─────────────────────┐     ┌────────────────────────────────────┐
│   SQLite Database   │     │         In-Process Queue           │
│     (better-sqlite3)│     │           src/queue.js             │
│                     │     │                                    │
│  feedback table:    │     │  • FIFO, concurrency=2             │
│  - id (UUID)        │◄────┤  • Updates status: RECEIVED        │
│  - content          │     │    → ANALYZING → DONE | FAILED     │
│  - content_hash     │     │  • Calls AIService.analyse()       │
│  - status           │     │  • Persists raw + validated result │
│  - raw_ai_response  │     └────────────────┬───────────────────┘
│  - analysis (JSON)  │                      │
│  - created_at       │                      │ HTTP POST /api/chat
│  - updated_at       │                      ▼
└─────────────────────┘     ┌────────────────────────────────────┐
                            │        AI Service (Ollama)         │
                            │          src/aiService.js          │
                            │                                    │
                            │  • Truncates input to 3000 chars   │
                            │  • Sends system prompt + content   │
                            │  • Strips markdown fences          │
                            │  • JSON.parse() → Zod validation   │
                            │  • Throws on schema mismatch       │
                            └────────────────────────────────────┘
```

---

## Component Breakdown

### 1. HTTP Layer (`src/routes.js`)

Thin routing layer. Validates inputs, delegates to FeedbackService, and translates results into HTTP responses. No business logic lives here.

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Liveness probe |
| `/feedback` | POST | Submit new feedback |
| `/feedback` | GET | List feedback (paginated, filterable by status) |
| `/feedback/:id` | GET | Get single feedback with analysis |
| `/feedback/:id/retry` | POST | Re-enqueue a FAILED item |

### 2. Feedback Service (`src/feedbackService.js`)

Orchestrates the submit/read/retry lifecycle. The only component that knows about both the DB layer and the queue. Key responsibility: ensure a response is returned to the caller before analysis begins.

### 3. Database Layer (`src/db.js`)

Thin wrapper around `better-sqlite3`. Uses prepared statements for all hot-path queries. Schema migration runs on first startup. WAL mode enables concurrent reads during writes.

**Schema:**
```sql
CREATE TABLE feedback (
  id           TEXT PRIMARY KEY,          -- UUID v4
  content      TEXT NOT NULL,             -- original user text
  content_hash TEXT NOT NULL UNIQUE,      -- SHA-256 for dedup
  status       TEXT NOT NULL DEFAULT 'RECEIVED'
               CHECK(status IN ('RECEIVED','ANALYZING','DONE','FAILED')),
  raw_ai_response TEXT,                   -- verbatim LLM output (or error)
  analysis        TEXT,                   -- validated JSON string
  created_at   TEXT NOT NULL,             -- ISO 8601
  updated_at   TEXT NOT NULL              -- ISO 8601
);
```

### 4. In-Process Queue (`src/queue.js`)

Simple async FIFO queue backed by an in-memory array. Processes up to 2 items concurrently (configurable). Uses no external dependencies.

```
enqueue(id, content)
    │
    ├─ push to pending[]
    └─ drain()
           │
           ├─ while active < CONCURRENCY && pending.length > 0
           │       active++
           │       process(job)
           │           ├── db.updateStatus(id, 'ANALYZING')
           │           ├── aiService.analyse(content)
           │           │       ├── success → db.updateAnalysis(id, { DONE, raw, analysis })
           │           │       └── failure → db.updateAnalysis(id, { FAILED, error, null })
           │           └── active-- → drain()
```

### 5. AI Service (`src/aiService.js`)

Integrates with Ollama's `/api/chat` endpoint. Responsibilities:
- **Truncation:** caps input at 3,000 characters to prevent context overflow
- **Prompt engineering:** system prompt forces pure JSON with no preamble
- **Fence stripping:** removes accidental ` ```json ``` ` wrappers
- **Validation:** Zod schema enforcement — any deviation throws

**Expected AI output schema (Zod-validated):**
```json
{
  "sentiment": "positive | neutral | negative",
  "feature_requests": [
    { "title": "string", "confidence": 0.0–1.0 }
  ],
  "actionable_insight": "string"
}
```

---

## Data Flow: Happy Path

```
1. POST /feedback { content: "..." }
2.   → FeedbackService.submit()
3.     → hashContent()                         [dedup check]
4.     → db.findByHash()                       [no match → proceed]
5.     → db.insert({ status: RECEIVED })
6.   ← 202 Accepted { id, status: RECEIVED }   [response returned here]
7.   → setImmediate → queue.enqueue(id, content)
8.     → db.updateStatus(id, ANALYZING)
9.     → aiService.analyse(content)
10.      → fetch Ollama /api/chat
11.      → JSON.parse + Zod validate
12.    → db.updateAnalysis(id, { DONE, raw, analysis })

GET /feedback/:id → { status: DONE, analysis: { ... } }
```

## Data Flow: Failure Path

```
9.     → aiService.analyse(content)   throws (network/validation error)
10.   → db.updateAnalysis(id, { FAILED, error_message, null })

POST /feedback/:id/retry
    → db.updateStatus(id, RECEIVED)
    → queue.enqueue(id, content)     [back to step 8]
```

---

## Guardrail: Hash-Based Deduplication

Content is normalised before hashing:
1. `.trim()` — remove leading/trailing whitespace
2. `.toLowerCase()` — case-insensitive matching
3. `.replace(/\s+/g, ' ')` — collapse internal whitespace

Then SHA-256 is applied. The hash is stored in a `UNIQUE` column so even a race condition between two identical concurrent submissions is handled at the DB level (one will get a UNIQUE constraint violation).

**Why this guardrail over the alternatives:**

| Option | Why not chosen |
|--------|---------------|
| Rate-limit AI analysis | Doesn't prevent wasted work — same content still processed |
| Cache analysis results | Needs eviction logic; hash-dedup already achieves idempotency |
| Token-length truncation | Implemented as a bonus guardrail anyway |

---

## Tradeoffs & Constraints

| Decision | Tradeoff |
|----------|----------|
| SQLite | Zero config, no infra. Not suitable for multi-process/high-write workloads. |
| In-process queue | No dependencies, but jobs are lost on crash. BullMQ + Redis for production. |
| Synchronous `better-sqlite3` | Simpler code, no callback hell. Blocks the Node event loop on writes — acceptable at this scale. |
| No dotenv package | One less dep for a trivial format. Would use `dotenv` in a real project. |
| No auth | Out of scope per spec. |
| No test suite | Time-boxed. Testability is built in (pure functions, thin layers). |

---

## Local Setup

```
Ollama (port 11434)
     ↑
Node.js process (port 3000)
     ↓
feedback.db (SQLite file, local disk)
```

All components run on localhost. No Docker, no external services required.
