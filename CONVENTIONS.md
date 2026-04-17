# Project Conventions

## File naming

- **kebab-case** for all files: `ai-service.js`, `feedback-service.js`, `db.js`
- **`src/`** for all server-side modules
- **`tests/`** for all test files, suffixed `.test.js`
- **`public/`** for static frontend assets

## Module style

- `'use strict'` at the top of every file
- CommonJS (`require` / `module.exports`) — no ESM in this project
- One responsibility per module — routes know nothing about the DB, services know nothing about HTTP

## Naming conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `feedback-service.js` |
| Variables / functions | camelCase | `hashContent`, `getDb` |
| Constants (env-derived) | UPPER_SNAKE | `OLLAMA_MODEL`, `DB_PATH` |
| DB status values | UPPER_SNAKE | `RECEIVED`, `ANALYZING`, `DONE`, `FAILED` |

## Environment variables

All config lives in `.env` (gitignored). `.env.example` is the source of truth for what vars exist.  
Env vars are loaded manually in `app.js` — no `dotenv` dependency.  
Never hardcode URLs, ports, or credentials in source files.

## Error handling

- Routes never `throw` — all errors flow through Express's error handler via `next(err)`
- Services return structured results (`{ ok, reason }`) rather than throwing for expected failures (e.g. duplicate, not found)
- Unexpected errors (DB crash, network failure) are allowed to propagate and are caught by the global error handler in `app.js`
- AI failures mark the record `FAILED` and store the raw error in `raw_ai_response` — never silently discard

## Database

- All queries use **prepared statements** (via `better-sqlite3`)
- Schema migrations run automatically on first `getDb()` call
- No ORM — plain SQL only
- `better-sqlite3` is synchronous by design; do not wrap in fake async

## Queue

- In-process FIFO queue — no external broker
- Max concurrency is a constant at the top of `queue.js` — change it there, not inline
- Queue jobs must be idempotent: re-enqueueing a `FAILED` item resets status to `RECEIVED` first

## AI service

- `analyse(content)` is the only public function — callers never know which provider is active
- Provider is selected solely via `LLM_PROVIDER` env var
- All providers must honour the same Zod output schema
- Temperature is always set to `0.1` for deterministic JSON output

## Tests

- `node:test` + `node:assert/strict` — no Jest, no Mocha
- `supertest` for HTTP layer tests only
- Tests never call Ollama — `queue.enqueue` is stubbed at the top of `http.test.js`
- DB is always `:memory:` in tests — never touch `feedback.db`
- Unit tests test pure functions only (no I/O)

## Commit style

Follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short imperative description>
```

| Type | When to use |
|------|------------|
| `feat` | New feature or module |
| `fix` | Bug fix |
| `test` | Adding or fixing tests |
| `refactor` | Code change with no behaviour change |
| `docs` | Documentation only |
| `chore` | Config, deps, tooling |

Examples:
```
feat: add SQLite database layer with WAL mode
feat: add async in-process analysis queue
fix: handle :memory: path in db.js without path.resolve
test: add unit tests for hashContent and parseAndValidate
chore: add concurrently for dev:all script
```
