---
name: api-contract-audit
description: >
  Audit API routes and server actions for contract consistency, backward compatibility,
  idempotency, schema evolution safety, and error contracts. Use when: changing API routes,
  modifying Prisma schema, adding new endpoints, or before shipping.
---

# API Contract Audit — The Claude Journal

You are a senior API engineer auditing an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. This system has multiple consumer surfaces — the public paper browser, the submission form, the editorial dashboard, user profiles — plus the peer-review skill that acts as an API consumer. Breaking a contract silently means papers become inaccessible, reviews are lost, or the editorial workflow breaks.

## Your Mindset

Think like a consumer of these APIs. For every endpoint and server action you review, ask:
- If I'm building a page against this action, what contract am I relying on?
- If this action changes, will my existing component break silently?
- If I accidentally trigger the same action twice, what happens?
- If the database schema changes, does the response shape change too?
- Are error responses predictable enough to handle programmatically?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to assess and report, not fix.
- You MAY run existing tests to check coverage
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific routes or actions.

If no arguments, run a **full audit** across all 5 dimensions.

---

## Dimension 1: Response Contract Consistency

**Question: Do all endpoints and actions follow a predictable response shape?**

- Read all API route handlers in `src/app/api/`
- Read all server actions in `src/lib/actions/`
- Check: Do success responses follow a consistent shape?
  - Do actions return raw Prisma objects, or transform through a DTO?
  - Does `src/lib/result.ts` (Result monad) provide a consistent success/failure shape?
- Check: Do error responses follow a consistent shape?
- Check: Are HTTP status codes used correctly and consistently?
- Check: Are date/time fields in a consistent format across all responses? (ISO 8601?)
- Check: Are null fields included in responses or omitted?

### Checklist:
- [ ] Server actions return values through Result monad (or consistent alternative)
- [ ] API routes return consistent response shapes
- [ ] Error responses include a machine-readable code/type
- [ ] HTTP status codes are correct and consistent
- [ ] Date/time fields use ISO 8601 consistently
- [ ] Null handling policy is consistent

---

## Dimension 2: Backward Compatibility & Breaking Changes

**Question: Can the API evolve without breaking existing consumers?**

- Check if response shapes are coupled to Prisma model shapes:
  - Do queries return raw Prisma objects? (Schema change = response change)
  - Or do they transform through a serializer? (Schema change is decoupled)
- Check recent Prisma migrations for:
  - Dropped columns that were previously in responses
  - Renamed columns
  - Changed types
  - Added required fields without defaults
- Check: Are there response fields that are database implementation details?

### Checklist:
- [ ] Responses are decoupled from raw Prisma model shape (or coupling is documented)
- [ ] No recent migrations dropped columns in active responses
- [ ] New required fields have defaults
- [ ] Database implementation details not leaked in responses

---

## Dimension 3: Idempotency

**Question: Is it safe to retry any action? What happens on double-submit?**

### Critical idempotency surfaces:
- **Paper submission** (`src/lib/actions/papers.ts`) — double-submit should not create duplicate papers
- **Review submission** (`src/lib/actions/reviews.ts`) — duplicate reviews have editorial consequences
- **Favourite toggle** (`src/lib/actions/social.ts`) — double-click should not create two favourites
- **Note creation** (`src/lib/actions/social.ts`) — duplicate notes pollute discussion
- **Status transition** (`src/lib/actions/editorial.ts`) — double-trigger should not advance state twice
- **Download logging** — double-download should not double-count

Check all server actions:
- Are POST-like actions idempotent or protected?
- Are toggle actions (favourite) atomic?
- Are status transitions guarded by current-state check?

### Checklist:
- [ ] Paper submission handles double-submit gracefully
- [ ] Review submission prevents duplicates (one review per reviewer per paper)
- [ ] Favourite toggle is atomic (safe on double-click)
- [ ] Note creation handles rapid duplicates
- [ ] Status transitions check current state before advancing
- [ ] Download logging handles concurrent downloads

---

## Dimension 4: Schema Evolution Safety

**Question: Can we change the database schema without breaking the running application?**

- Check Prisma migration files
- Review the schema for:
  - **Safe operations**: Add column (nullable or with default), add table, add index
  - **Unsafe operations**: Drop column, drop table, rename column, change type, add NOT NULL without default
- Check: Is there a migration rollback procedure?
- Check: Can migrations run while the app serves traffic?

### Checklist:
- [ ] Prisma migrations are versioned and committed
- [ ] No recent migrations with unsafe operations (or documented)
- [ ] New columns are nullable or have defaults
- [ ] Migration rollback procedure exists
- [ ] Large table index additions planned for low-traffic windows

---

## Dimension 5: Error Contract

**Question: Can a consumer programmatically handle every error?**

- Check all error responses across routes and actions:
  - Is there an error code that consumers can switch on?
  - Are validation errors structured? (Which field failed? Why?)
  - Are 500 errors safe? (No stack traces, no SQL leaked)
- Check: Does the Result monad provide structured error information?
- Check: Are Prisma errors (P2002 unique, P2025 not found) caught and translated?
- Check `src/lib/middleware/stacks.ts` — what does the error handling middleware do?

### Checklist:
- [ ] Error responses include machine-readable error code/type
- [ ] Validation errors specify which field(s) failed
- [ ] 500 errors don't leak internals
- [ ] Prisma errors caught and translated (P2002→conflict, P2025→not found)
- [ ] State machine transition errors are descriptive (current state, attempted transition)
- [ ] Auth errors are distinguishable (not logged in, insufficient role, session expired)

---

## Step 2: Map All Endpoints and Actions

Build a complete inventory:

**API Routes:**
```bash
find app/src/app/api -name "route.ts" | sort
```

**Server Actions:**
```bash
find app/src/lib/actions -name "*.ts" | sort
```

For each, record:
- Method/name
- Auth required? (public/authenticated/editor)
- Input shape
- Response shape
- Error responses
- Idempotent?

---

## Step 3: Report

### Summary
One paragraph: overall API contract health.

### Scorecard

| Dimension | Score (/5) | Key Finding |
|-----------|-----------|-------------|
| Response Consistency | | |
| Backward Compatibility | | |
| Idempotency | | |
| Schema Evolution | | |
| Error Contract | | |

**Scoring:**
- 5 = Solid contract, consumers can rely on it
- 4 = Minor inconsistencies, low risk
- 3 = Notable gaps, some consumer breakage risk
- 2 = Significant gaps, breaking changes likely
- 1 = No contract discipline, consumers are guessing

### Idempotency Gaps
- Actions where double-submit creates problems, risk level, fix recommendation

### Contract Inconsistencies
- Actions that deviate from the common pattern

### Migration Safety Issues
- Unsafe schema changes, affected tables, mitigation

### Passed Checks
- Routes/actions with solid contracts

### Endpoint & Action Inventory
Full table with contract details.

## Key Files Reference

| File | Contract Role |
|------|--------------|
| `app/src/lib/actions/papers.ts` | Paper submission — highest idempotency risk |
| `app/src/lib/actions/reviews.ts` | Review submission — editorial impact |
| `app/src/lib/actions/social.ts` | Social actions — favourite, note, read-mark |
| `app/src/lib/actions/editorial.ts` | Editorial actions — status transitions |
| `app/src/lib/result.ts` | Result monad — defines success/failure contract |
| `app/src/lib/validation/combinators.ts` | Validation — defines error shape |
| `app/src/lib/paper-workflow.ts` | State machine — defines valid transitions |
| `app/src/lib/middleware/stacks.ts` | Middleware — defines error handling |
| `app/src/app/api/auth/github/route.ts` | OAuth initiation |
| `app/src/app/api/auth/github/callback/route.ts` | OAuth callback |
| `app/src/app/api/auth/me/route.ts` | Current user |
| `app/src/app/api/auth/logout/route.ts` | Session termination |
| `app/src/app/api/papers/[paperId]/download/route.ts` | PDF download |
| `app/src/app/api/search/route.ts` | Search endpoint |
