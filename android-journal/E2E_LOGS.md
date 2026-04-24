# E2E Logging — What Gets Logged

Implemented 2026-04-24. Updated 2026-04-24 with comprehensive logging.

Full documentation at `app/docs/LOGGING.md`.

---

## Logging Layers (what you see at 3am)

### Layer 1: Every HTTP Request (edge middleware)

Every single request is logged with method, path, status, duration, and IP.

```json
{"level":30,"time":1714000000,"msg":"request","method":"GET","path":"/papers","status":200,"ms":2,"ip":"1.2.3.4"}
{"level":30,"time":1714000001,"msg":"request","method":"GET","path":"/api/search?q=cat","status":200,"ms":1,"ip":"1.2.3.4"}
{"level":40,"time":1714000002,"msg":"request","method":"POST","path":"/api/auth/logout","status":403,"ms":0,"ip":"5.6.7.8"}
```

Source: `middleware.ts` (edge runtime, console.log structured JSON)

### Layer 2: Every API Route Completion (RouteBuilder)

API routes that go through RouteBuilder log method, path, status code, duration, and correlationId/userId.

```json
{"level":30,"correlationId":"abc-123","userId":42,"method":"GET","path":"/api/search","status":200,"ms":45,"route":"search","msg":"GET /api/search 200 45ms"}
```

Source: `lib/middleware/builder.ts`

### Layer 3: Every Action Step Trace (withActionTrace)

Every Server Action and raw API route logs a complete step-by-step trace showing exactly what happened under the hood.

Source: `lib/trace.ts`

### Layer 4: Every Search Query

Search queries are logged with the search term, category filter, result count, and DB query time.

```json
{"level":30,"correlationId":"abc-123","query":"category theory","category":null,"page":1,"results":5,"ms":12,"msg":"search: \"category theory\" → 5 results (12ms)"}
```

Source: `app/api/search/route.ts`

### Layer 5: Database Warnings and Errors

Prisma warns and errors are captured and logged as structured JSON.

```json
{"level":40,"time":1714000000,"msg":"prisma:warn","detail":"..."}
{"level":50,"time":1714000000,"msg":"prisma:error","detail":"Connection refused"}
```

Source: `lib/db.ts` (Prisma event logging)

A `timedQuery(label, fn)` helper is available for wrapping critical queries — logs if a query takes >200ms.

### Layer 6: Startup Context

Server start logs Node version, environment, PID, DB connectivity check, and env var validation.

```json
{"level":30,"node":"v22.0.0","env":"production","pid":12345,"platform":"darwin","logLevel":"info","msg":"server starting"}
{"level":30,"msg":"database connected"}
{"level":30,"msg":"production env checks passed"}
{"level":30,"msg":"instrumentation complete"}
```

Source: `instrumentation.ts`

### Layer 7: Shutdown and Fatal Errors

SIGTERM, SIGINT, uncaughtException, and unhandledRejection are all caught and logged before exit.

```json
{"level":60,"err":{"type":"Error","message":"...","stack":"..."},"msg":"FATAL uncaughtException"}
{"level":30,"msg":"SIGTERM received, draining connections..."}
```

Source: `instrumentation.ts`

---

## E2E Action Traces (Pino stdout)

Every user action logs a **complete step-by-step trace** via `withActionTrace`. When something fails, the trace shows exactly which step broke and why.

Implementation: `app/src/lib/trace.ts`

### How It Works

1. User performs an action (Server Action or API route)
2. `withActionTrace` generates a `correlationId`, sets up AsyncLocalStorage
3. Each internal step is recorded: `mark` (passed check), `fail` (rejected), `step` (timed async op)
4. On completion, the full trace is logged as one structured Pino JSON line
5. The same `correlationId` is written to any AuditLog rows created during the action

### Trace Output Format

**Success:**
```json
{
  "level": 30,
  "correlationId": "abc-123",
  "userId": 42,
  "trace": {
    "action": "paper.submit",
    "ms": 245,
    "status": "ok",
    "steps": [
      { "name": "auth", "status": "ok", "ms": 0 },
      { "name": "validate", "status": "ok", "ms": 0 },
      { "name": "pdf-validate", "status": "ok", "ms": 0 },
      { "name": "db-create", "status": "ok", "ms": 12 },
      { "name": "file-store", "status": "ok", "ms": 8 },
      { "name": "audit", "status": "ok", "ms": 0 }
    ]
  },
  "msg": "paper.submit completed"
}
```

**Business-logic rejection (e.g. validation failure):**
```json
{
  "level": 40,
  "correlationId": "def-456",
  "userId": 42,
  "trace": {
    "action": "paper.submit",
    "ms": 2,
    "status": "err",
    "steps": [
      { "name": "auth", "status": "ok", "ms": 0 },
      { "name": "extract-fields", "status": "ok", "ms": 0 },
      { "name": "validate", "status": "err", "ms": 0, "error": "Title is required" }
    ],
    "error": "Title is required"
  },
  "msg": "paper.submit rejected"
}
```

**Unexpected exception (e.g. DB crash):**
```json
{
  "level": 50,
  "correlationId": "ghi-789",
  "userId": 42,
  "trace": {
    "action": "paper.submit",
    "ms": 15,
    "status": "err",
    "steps": [
      { "name": "auth", "status": "ok", "ms": 0 },
      { "name": "validate", "status": "ok", "ms": 0 },
      { "name": "db-create", "status": "err", "ms": 15, "error": "Connection refused" }
    ],
    "error": "Connection refused"
  },
  "msg": "paper.submit threw"
}
```

### Debugging Workflow

When a user reports a problem:

```bash
# 1. Find the trace by action name and status
cat logs.json | jq 'select(.trace.action == "paper.submit" and .trace.status == "err")'

# 2. Or find by correlationId (from an audit log row)
cat logs.json | jq 'select(.correlationId == "abc-123")'

# 3. See which step failed
cat logs.json | jq '.trace.steps[] | select(.status == "err")'
```

### All Traced Actions

#### Server Actions (7)

| Action | Trace Name | Steps |
|--------|-----------|-------|
| `submitPaper` | `paper.submit` | auth, extract-fields, validate, pdf-check/pdf-magic, latex-check, user-lookup, db-create, file-store, audit |
| `addNote` | `note.add` | auth, validate, paper-lookup, parent-check, db-create, audit |
| `toggleFavourite` | `favourite.toggle` | auth, paper-lookup, db-toggle |
| `markAsRead` | `read.mark` | auth, paper-lookup, db-upsert |
| `updatePaperStatus` | `paper.transition` | auth-editor, transition |
| `assignReviewer` | `reviewer.assign` | auth-editor, user-lookup, paper-lookup, status-check, author-check, dup-check, db-create, audit |
| `submitReview` | `review.submit` | auth, validate, paper-lookup, status-check, assignment-check, db-update, audit |

#### API Routes (2)

| Route | Trace Name | Steps |
|-------|-----------|-------|
| `GET /api/papers/[id]/download` | `paper.download` | auth, paper-lookup, path-resolve, path-guard, download-log, file-stat |
| `GET /api/auth/github/callback` | `auth.github-callback` | state-check, token-exchange, token-validate, user-fetch, user-validate, db-upsert, session-create, audit |

### Step Types

- **`mark`** — Synchronous check passed (0ms). Example: auth verified, validation passed
- **`fail`** — Synchronous check rejected. The action returns an error. Shows what was wrong
- **`step`** — Timed async operation (DB query, file I/O, external API). Shows duration in ms. If it throws, the error is captured and re-thrown

---

## AuditLog Table (queryable, powers dashboard + alerts)

Each audit event now includes `correlationId` linking it to its trace in Pino logs.

| Action | Entity | Source | Details |
|--------|--------|--------|---------|
| `paper.submitted` | paper | `actions/papers.ts` | After storePaperFiles succeeds |
| `paper.transitioned` | paper | `paper-workflow.ts` | From/to status in details field |
| `review.assigned` | review | `actions/editorial.ts` | After reviewer placeholder created |
| `review.submitted` | review | `actions/reviews.ts` | After review.update |
| `note.added` | note | `actions/social.ts` | After note.create |
| `paper.downloaded` | paper | `api/papers/[paperId]/download/route.ts` | Download event |
| `auth.login` | user | `api/auth/github/callback/route.ts` | Successful login |
| `auth.failed` | user | `api/auth/github/callback/route.ts` | Failed login attempt |
| `access.denied` | system | `middleware/with-role.ts` | 403 response |
| `system.error` | system | `middleware/builder.ts` | Unhandled exception in route |

## Pino stdout only (not database)

| Event | Source | Why not DB |
|-------|--------|-----------|
| Rate limit hit (429) | `middleware.ts` | Edge runtime, too noisy |
| CSRF rejection (403) | `middleware.ts` | Edge runtime, too noisy |
| **Action traces** | `lib/trace.ts` | Step-level detail is too granular for DB; searchable via Pino JSON |

## NOT logged (intentional)

| Event | Why |
|-------|-----|
| Page views / GET requests | Too noisy, no signal |
| Favourites | High volume, low stakes (but traced via `favourite.toggle` in Pino) |
| Read-marking | High volume, low stakes (but traced via `read.mark` in Pino) |
| Search queries | Could add later for analytics, but not audit-relevant |

## Alert Rules (cron, every 6 hours)

| # | Rule | Condition | Severity |
|---|------|-----------|----------|
| 1 | Stale submissions | Paper in `submitted` >3 days | MEDIUM |
| 2 | Stale reviews | Reviewer assigned >7 days, scores zero | MEDIUM |
| 3 | Access denied | Any `access.denied` in window | HIGH |
| 4 | System errors | 3+ `system.error` in window | HIGH |
| 5 | Publication | Any paper published | INFO |

## Weekly Digest (Monday 8am, always sent)

Covers: submissions, publications, reviews completed, stale items, errors, download counts.

## Implementation Notes

All review findings from `~/.claude/plans/glittery-bubbling-castle.md` were addressed:

1. `paper.transitioned` logged only in `paper-workflow.ts` (not duplicated in `editorial.ts`)
2. Composite `@@index([action, timestamp])` added to AuditLog schema
3. Startup guards added in `instrumentation.ts` for `JWT_SECRET` / `DATABASE_URL`
4. Monitoring dashboard at `/admin/monitoring` (admin-only, 4 sections)
5. Alert scanner tested — found stale submission 2026-014
6. Weekly digest tested — reported 1 submission, 28 reviews, 9 downloads

### Trace system (2026-04-24)

7. `withActionTrace` wrapper in `lib/trace.ts` fixes the Server Action ALS gap — correlationId and userId are now populated for all downstream logging
8. `correlationId` column added to AuditLog schema — links audit events to their traces
9. All 7 Server Actions + 2 raw API routes instrumented with step-level traces
10. Pre-existing bug fixed: CLI `paper download --format` conflicted with global `--format` option; renamed to `--file-type`
