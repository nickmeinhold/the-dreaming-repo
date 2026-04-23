---
name: production-ready
description: >
  Production readiness audit across 6 dimensions: observability, reliability, data integrity,
  performance, concurrency, and deployment safety. Complements security-audit with operational
  concerns. Use when: after adding features, before shipping, or for periodic review.
---

# Production Readiness Audit — The Claude Journal

You are a senior SRE auditing an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. The system handles paper submissions from AI instances and humans, peer review workflows, GitHub OAuth, and social features (notes, favourites, interest matching). Downtime means submissions stall, reviews are lost, and the community's trust erodes.

**This is a toy-vs-production assessment.** A toy works on the happy path. Production works at 3am when the database is slow, two reviewers submit at the same time, and GitHub OAuth is returning 503s.

## Your Mindset

Think like an on-call engineer investigating after an incident. For every surface you review, ask:
- What happens when this fails? Does anyone know?
- What happens under 10x load? (100 concurrent paper views, 50 search queries/sec)
- What happens when two users do this simultaneously?
- Can I deploy a schema change without downtime?
- If the database corrupts, how fast can I recover?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to assess and report, not fix. A separate builder agent will action your recommendations.
- You MAY run existing tests (`npm test` or `npx vitest run`) to check coverage
- Do NOT run destructive commands (migrations, DB changes, npm install)

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific dimensions.

If no arguments, run a **full audit** across all 6 dimensions.

---

## Dimension 1: Observability

**Question: After an incident, can we answer "what happened?" In real time, can we answer "what's happening?"**

### Structured Logging
- Check all `console.log`, `console.error`, `console.warn` calls across the codebase
- Is Pino (`src/lib/` or imports) configured with structured JSON output?
- Do log lines include: timestamp, request ID, user ID, action, paper ID?
- Check `src/lib/middleware/with-trace.ts` — does it propagate trace/request IDs?

### Metrics
- Search for any metrics collection (Prometheus client, OpenTelemetry, StatsD, custom counters)
- Key metrics an academic journal needs:
  - Request latency (p50, p95, p99) per route
  - Error rate per route
  - DB query duration
  - Active sessions count
  - Search query latency
  - Paper download count (real-time, not just DB log)

### Tracing
- Search for trace IDs, correlation IDs, request IDs
- Can you follow a single user action (e.g., "author submits paper") across:
  - API route → middleware stack → DB write → event bus → search index update?
- Check if `with-trace.ts` middleware threads trace IDs through the async context

### Health Checks
- Search for `/api/health`, `/api/ready`, `/healthz` endpoints
- A health check should verify: app is running, DB is reachable, migrations are current
- Check for `HEALTHCHECK` in any Docker/container config

### Checklist:
- [ ] Structured log format (JSON with consistent fields via Pino)
- [ ] Log levels configurable per environment
- [ ] Request/trace ID threaded through all log lines via async context
- [ ] Metrics endpoint or push-based metrics collection
- [ ] Latency histograms on API routes
- [ ] Error rate counters
- [ ] Health check endpoint (liveness + readiness)
- [ ] Event bus emissions are logged/traced

---

## Dimension 2: Reliability

**Question: Does the system degrade gracefully, or does one failure cascade?**

### Graceful Failure
- What happens when the DB is unreachable? Run through the request path.
- What happens when GitHub OAuth is down? Check `src/app/api/auth/github/` error handling.
- What happens when GitHub API returns 503 during callback? Check `src/app/api/auth/github/callback/route.ts`.
- Does the system have error boundaries in React? Search for `ErrorBoundary` in `src/`.
- Check: Do errors return appropriate HTTP status codes (400 vs 404 vs 500)?
- Check: Are error messages safe? (No stack traces, no internal paths leaked to client)

### Retry Strategies
- Search for any retry logic (exponential backoff, retry count)
- Key operations that SHOULD retry on transient failure:
  - DB connections (Prisma connection pool via `pg` adapter)
  - GitHub API calls during OAuth callback
  - Search index updates
- Check `src/lib/db.ts` — Prisma connection pool config

### No Silent Failures
- Search for empty `catch` blocks: `catch\s*\([^)]*\)\s*\{[\s]*\}`
- Search for `catch` blocks that only log but don't propagate or record the failure
- If the event bus (`src/lib/events/bus.ts`) handler fails, is that visible?
- Does `src/lib/result.ts` (Result monad) properly surface errors or swallow them?

### Process-Level Safety
- Search for `process.on('uncaughtException')` and `process.on('unhandledRejection')`
- Check for graceful shutdown handling (SIGTERM -> drain connections -> exit)

### Checklist:
- [ ] All routes use middleware stack for error handling
- [ ] Error responses don't leak internals (stack traces, file paths, SQL)
- [ ] GitHub OAuth failures return a user-friendly message
- [ ] Event bus handler failures are logged and don't block the request
- [ ] Result monad errors are surfaced, not swallowed
- [ ] Retry with backoff on transient DB/GitHub failures
- [ ] React error boundaries prevent white-screen crashes
- [ ] Process-level exception handlers for graceful shutdown
- [ ] No empty catch blocks
- [ ] External API calls have timeouts (GitHub OAuth)

---

## Dimension 3: Data Integrity

**Question: Can data become inconsistent, and would we know?**

### Transactions
- Search for `$transaction` in the codebase
- Identify multi-step write operations that SHOULD be transactional:
  - Paper submission: create Paper + PaperAuthor + PaperTag records (orphans if crash mid-way)
  - Status transition: update paper status + create command history entry
  - Review submission: create Review + potentially trigger status change
  - Social actions: create Favourite/Note + update counts (if denormalized)
- Check `src/lib/commands/editorial.ts` — are status transitions atomic?
- Check `src/lib/submission/mediator.ts` — is submission creation transactional?

### Database Constraints
- Read `prisma/schema.prisma` (or check `src/generated/prisma/`) for:
  - `@unique` constraints — especially on User.login (GitHub), Paper.paperId (YYYY-NNN)
  - `@index` declarations
  - `@relation` with `onDelete` behaviour
  - Required vs optional fields
- Check: Can two papers have the same YYYY-NNN ID? (They shouldn't)
- Check: Can two users have the same GitHub login? (They shouldn't)

### Validation
- Read `src/lib/validation/combinators.ts` — what does it validate?
- Are there any write paths that bypass validation?
  - Check server actions: `src/lib/actions/papers.ts`, `editorial.ts`, `social.ts`, `reviews.ts`
  - Check API routes: `src/app/api/`

### Referential Integrity
- Check `onDelete` behaviour on all relations
- If a paper is deleted, what happens to its reviews, notes, favourites, downloads?
- Is cascading delete appropriate for any relations? (Reviews should probably be preserved)

### Checklist:
- [ ] Multi-step writes wrapped in `$transaction`
- [ ] `@unique` on business keys (paperId YYYY-NNN, user GitHub login)
- [ ] `@index` on foreign keys and query-critical columns
- [ ] Validation called on ALL write paths (actions + API routes)
- [ ] No cascading deletes on review/note data (academic record)
- [ ] Paper ID generation (`src/lib/paper-id.ts`) is race-safe
- [ ] Command history is append-only (no updates/deletes)

---

## Dimension 4: Performance

**Question: Will this system handle the journal's load without degrading?**

### Latency
- Check for N+1 query patterns — do paper list queries eagerly load all relations?
- Check `src/app/papers/page.tsx` and `src/app/papers/[paperId]/page.tsx` — how many queries per page load?
- Check search: `src/lib/search.ts` and `src/lib/search/tsvector.ts` — is full-text search indexed?
- Check interest matching: `src/lib/interest-matching.ts` — is this O(n^2) over all users?

### Pagination
- Search for `skip`, `take`, `limit`, `offset`, `cursor` in actions and API routes
- Check: What happens with 1,000 papers? 10,000 notes?
- Check tag pages: `src/app/tags/[slug]/page.tsx` — paginated?
- Check user profiles: `src/app/users/[login]/page.tsx` — paginated?

### Memory
- Check paper download route: `src/app/api/papers/[paperId]/download/route.ts` — are PDFs streamed or buffered?
- Check search — are large result sets trimmed?

### Caching
- Search for any caching: `unstable_cache`, `revalidate`, `Map`-based LRU, `lru-cache`
- Tag lists and paper counts are semi-static — are they cached?
- Published papers are immutable once published — are they cached aggressively?

### Database Performance
- Check for indexes in Prisma schema beyond primary keys
- Key columns that need indexes: all foreign keys, `paperId`, `status`, `tagSlug`, search tsvector column

### Checklist:
- [ ] Pagination on all list endpoints (papers, tags, notes, reviews, user profiles)
- [ ] Selective relation loading (not eager-load-everything)
- [ ] Full-text search uses PostgreSQL tsvector index
- [ ] Interest matching has reasonable algorithmic complexity
- [ ] PDF downloads use streaming, not buffering
- [ ] Published papers cached (immutable after acceptance)
- [ ] Tag/count queries cached with appropriate revalidation
- [ ] Database indexes on foreign keys and query columns
- [ ] No unbounded in-memory data loading

---

## Dimension 5: Concurrency

**Question: Can two users doing the same thing at the same time corrupt data?**

### Race Conditions
- Check paper ID generation (`src/lib/paper-id.ts`) — if two submissions happen simultaneously, do they get the same YYYY-NNN? Is there a DB-level unique constraint as a safety net?
- Check status transitions (`src/lib/paper-workflow.ts`, `src/lib/commands/editorial.ts`) — if two editors act simultaneously, can the paper reach an invalid state?
- Check `src/lib/events/bus.ts` — are event handlers safe under concurrent dispatch?

### Double Writes
- Double-POST to submit a paper — does it create two papers?
- Double-click on favourite — does it create two favourites?
- Double-submit a review — does it create two reviews?
- Check: Is the favourite toggle atomic (upsert/delete, not check-then-create)?
- Check `src/lib/actions/social.ts` — are social actions idempotent?

### Optimistic Concurrency
- If two reviewers submit reviews simultaneously, does anything break?
- If an editor transitions paper status while an author is editing, what happens?
- Check: Do status transitions use a where-clause version check?

### Checklist:
- [ ] Paper ID generation is serialized or uses DB unique constraint
- [ ] Status transitions are atomic (check-current-state + update in one transaction)
- [ ] Favourite toggle is idempotent (safe on double-click)
- [ ] Review submission handles duplicates gracefully
- [ ] Event bus handlers are safe under concurrent dispatch
- [ ] No TOCTOU races in check-then-act patterns

---

## Dimension 6: Deployment Safety

**Question: Can we ship changes without breaking production?**

### Migrations
- Check Prisma migration strategy — are migrations in `prisma/migrations/`?
- Check: Does the migration engine guard against destructive operations?
- Check: Can migrations run while the app is serving traffic?
- Check: Is there a rollback procedure for a bad migration?

### Environment & Secrets
- Check for `.env.example` or documented environment variables
- Search for hardcoded secrets: API keys, GitHub client secrets, JWT secrets in source code
- Check `.gitignore` — is `.env` excluded?
- Check: Are GitHub OAuth credentials (client ID, client secret) injected via env vars?
- Check `src/lib/auth.ts` — how are JWT/session secrets configured?

### Container & Orchestration
- Check for Dockerfile, docker-compose.yml
- Check for health checks in container config
- Does the app wait for PostgreSQL to be ready?

### CI/CD
- Check `.github/workflows/` for CI pipeline
- Check: Are tests, linting, type-checking, and build ALL in the pipeline?

### Checklist:
- [ ] Prisma migrations are versioned and committed
- [ ] No secrets in source code
- [ ] `.env` in `.gitignore`
- [ ] GitHub OAuth credentials via env vars
- [ ] JWT/session secret via env vars with startup validation
- [ ] CI runs: lint, type-check, unit tests, build
- [ ] Rollback procedure documented
- [ ] Database backup strategy exists

---

## Step 2: Run Existing Tests

```bash
cd app && npx vitest run
```

Check test coverage for operational concerns:
- Are there tests for error handling edge cases?
- Are there tests for concurrent access?
- Are there tests for the state machine transitions?
- Are there tests for search edge cases?

## Step 3: Report

Produce a structured report with a scorecard:

### Scorecard

| Dimension | Score | Critical Gaps |
|-----------|-------|---------------|
| Observability | /5 | ... |
| Reliability | /5 | ... |
| Data Integrity | /5 | ... |
| Performance | /5 | ... |
| Concurrency | /5 | ... |
| Deployment Safety | /5 | ... |

**Scoring:**
- 5 = Production-ready, no gaps
- 4 = Minor improvements needed, safe to deploy
- 3 = Notable gaps, deploy with monitoring
- 2 = Significant gaps, fix before deploying
- 1 = Critical gaps, do not deploy

### Critical (must fix before deployment)
- Finding, affected file:line, fix recommendation, estimated effort

### High (fix within first sprint post-deployment)
- Finding, affected file:line, fix recommendation

### Medium (fix within first month)
- Finding, fix recommendation

### Low (defence-in-depth, nice to have)
- Finding, fix recommendation

### Passed Checks
- List operational controls that are correctly implemented

### Recommended Implementation Order
Prioritised list of fixes. Group by effort (quick wins vs projects). For each:
- What to implement
- Which dimension it improves
- Dependencies on other fixes
- Estimated complexity (S/M/L)

## Key Files Reference

| File | Operational Role |
|------|-----------------|
| `app/src/lib/middleware/stacks.ts` | Middleware composition — centralised request handling |
| `app/src/lib/middleware/with-trace.ts` | Request tracing / correlation IDs |
| `app/src/lib/middleware/with-session.ts` | Session verification |
| `app/src/lib/middleware/with-role.ts` | Role-based access control |
| `app/src/lib/middleware/async-context.ts` | AsyncLocalStorage for request context |
| `app/src/lib/result.ts` | Result monad — error propagation |
| `app/src/lib/events/bus.ts` | Event bus — async side effects |
| `app/src/lib/commands/editorial.ts` | Editorial commands — status transitions |
| `app/src/lib/commands/history.ts` | Command history — append-only audit trail |
| `app/src/lib/paper-workflow.ts` | Paper state machine |
| `app/src/lib/paper-id.ts` | Paper ID generation (YYYY-NNN) |
| `app/src/lib/search/tsvector.ts` | Full-text search implementation |
| `app/src/lib/interest-matching.ts` | User interest similarity (Jaccard?) |
| `app/src/lib/db.ts` | Prisma client / connection pool |
| `app/src/lib/auth.ts` | Auth configuration — JWT/session secrets |
| `app/src/lib/storage.ts` | File storage (PDF uploads) |
| `app/src/app/api/auth/github/callback/route.ts` | GitHub OAuth callback |
| `app/src/app/api/papers/[paperId]/download/route.ts` | PDF download |
| `app/src/app/api/search/route.ts` | Search endpoint |

## What to Flag Even If It Looks Intentional

- Any list endpoint without pagination
- Any write operation without a surrounding `$transaction` (if multi-step)
- Any `catch` block that swallows errors silently
- Any hardcoded credentials in source code
- Any missing database index on a foreign key column
- Any file I/O that buffers entire files into memory
- Any external API call without a timeout
- Any event bus handler that could silently fail
