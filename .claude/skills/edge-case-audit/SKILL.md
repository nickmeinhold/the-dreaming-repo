---
name: edge-case-audit
description: >
  Audit the journal codebase for edge cases across 8 dimensions: input validation,
  paper ID/workflow, concurrency, data integrity, memory/performance, search/discovery,
  access control, and external integrations. Use when: adding features, changing API routes,
  modifying schema, updating parsers, or before shipping.
---

# Edge Case Audit — The Claude Journal

You are a senior backend engineer hunting for edge cases in an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. Edge cases in a journal platform undermine trust — a duplicate paper ID corrupts citations, a broken state transition loses a submission, a search bug makes papers invisible.

## Your Mindset

Think like QA trying to break the system. For every surface you review, ask:
- What happens with unexpected input? (empty strings, nulls, huge abstracts, special characters in titles)
- What happens at boundaries? (paper ID rollover YYYY-999→next, empty tag lists, zero reviews)
- What happens when two users act simultaneously? (double-submit, concurrent status transitions)
- What happens when external systems fail? (GitHub OAuth down, DB connection pool exhausted)
- What data types could lose precision or silently truncate?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to find and report, not fix.
- You MAY run existing tests to check coverage
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific files or areas.

If no arguments, run a **full audit** across all 8 dimensions.

---

## Dimension 1: Input Validation

**Question: Can a user submit data that bypasses validation and corrupts the database or crashes the server?**

- Check all server actions in `src/lib/actions/` — does every action validate input?
- Check API routes in `src/app/api/` — do they validate before processing?
- Check `src/lib/validation/combinators.ts` — what does the validation framework cover?
- Look for `parseInt()`, `new Date()` on unvalidated input
- Check that enum fields (paper status, author type, category) validate against allowed values
- Check for unbounded string fields — can someone submit a 10MB abstract?
- Check metadata.yaml parsing (`src/lib/yaml.ts`) — what happens with malformed YAML?

### Checklist:
- [ ] All server actions validate input before DB writes
- [ ] All API routes validate input before processing
- [ ] Paper category validated against `research | expository`
- [ ] Author type validated against `autonomous | claude-human | human`
- [ ] Paper status transitions validated by state machine
- [ ] String fields have reasonable length limits (title, abstract, note content)
- [ ] YAML parsing handles malformed input gracefully
- [ ] Tag names/slugs validated (no special characters, reasonable length)

---

## Dimension 2: Paper ID & Workflow

**Question: Can the paper ID system or workflow state machine reach an invalid state?**

- Check `src/lib/paper-id.ts` — paper IDs are `YYYY-NNN`:
  - What happens at YYYY-999? Does it roll to YYYY-1000 or break?
  - What if two submissions happen in the same millisecond?
  - Is the sequence number DB-backed or computed from existing papers?
  - What happens across year boundaries (last paper of 2026, first of 2027)?
- Check `src/lib/paper-workflow.ts` — the state machine:
  - Are all valid transitions defined? (submitted→under-review→revision→accepted→published)
  - What happens if someone tries an invalid transition? (published→submitted)
  - Are transitions reversible where they should be? (under-review→revision→under-review)
  - What happens if the paper has no reviews but someone tries to accept it?
- Check `src/lib/commands/editorial.ts` — command execution:
  - Are commands validated against the state machine before execution?
  - Is command history (`src/lib/commands/history.ts`) truly append-only?
  - What happens if command execution fails mid-way?

### Checklist:
- [ ] Paper ID generation handles YYYY-999 rollover
- [ ] Paper ID generation is race-safe (DB constraint + serialization)
- [ ] Year boundary crossing works correctly
- [ ] All state machine transitions are explicitly defined
- [ ] Invalid transitions are rejected with clear errors
- [ ] State machine + command system are consistent (can't reach state without command)
- [ ] Command history is truly immutable

---

## Dimension 3: Concurrency & Race Conditions

**Question: What happens when two users perform the same action at the same time?**

- Check paper submission for duplicate ID generation race
- Check favourite toggle (`src/lib/actions/social.ts`) — double-click creates two records?
- Check review submission — can two reviewers submit and both trigger a status change?
- Check note creation — duplicate notes on rapid submit?
- Check status transitions — two editors acting on same paper simultaneously

### Checklist:
- [ ] Paper ID generation uses serializable transaction or DB sequence
- [ ] Favourite toggle is atomic (upsert/delete, not check-then-create)
- [ ] Review submission doesn't double-trigger status transition
- [ ] Note creation handles rapid duplicates
- [ ] Status transitions use optimistic locking or serializable transaction
- [ ] Download logging handles concurrent downloads of same paper

---

## Dimension 4: Data Integrity

**Question: Can data be silently corrupted, truncated, or lost?**

- Check Prisma schema types — are any fields using wrong types?
- Check `onDelete` behaviour on all relations:
  - Deleting a user: what happens to their papers, reviews, notes, favourites?
  - Deleting a paper: what happens to reviews, notes, favourites, downloads?
  - Are downloads/reviews permanent record? (academic integrity requires preservation)
- Check that paper status can only change through the state machine, not direct DB update
- Check event bus — can events be lost? Is there at-least-once delivery?

### Checklist:
- [ ] No cascading deletes on academic record (reviews, published papers)
- [ ] Paper status changes only through state machine / command system
- [ ] Event bus failures don't corrupt state
- [ ] Author associations (PaperAuthor) maintain referential integrity
- [ ] Tag associations (PaperTag) maintain referential integrity
- [ ] Download log is append-only (no updates/deletes)

---

## Dimension 5: Memory & Performance

**Question: Can a single request exhaust the Node.js heap or block the event loop?**

- Check for unbounded queries in page components and server actions
- Check PDF download route — streaming or buffering?
- Check search — what happens with a very broad search returning 10,000 results?
- Check interest matching — O(n^2) user comparison on large user bases?
- Check tag page — loading all papers for a popular tag without pagination?
- Check user profile — loading entire history (papers, reviews, notes, downloads)?

### Checklist:
- [ ] All list views paginate results
- [ ] PDF downloads stream, not buffer
- [ ] Search results are capped/paginated
- [ ] Interest matching algorithm is bounded
- [ ] No unbounded `findMany` in page components
- [ ] Large paper metadata (abstract, full text) is loaded selectively

---

## Dimension 6: Search & Discovery

**Question: Can papers become invisible or unfindable?**

- Check `src/lib/search/tsvector.ts` and `src/lib/search/sanitize.ts`:
  - What happens with special characters in search queries? (SQL injection via tsvector?)
  - What happens with very long search queries?
  - What happens with empty search?
  - Are stop words handled? Does searching "the" return everything or nothing?
- Check tag system:
  - Can a paper have zero tags? Is it still discoverable?
  - What happens with tag names containing special characters?
  - Is tag slug generation deterministic? (`src/__tests__/slug-adjunction.test.ts` suggests yes)
- Check: Are draft/submitted papers excluded from public search?
- Check: Can published papers ever become unsearchable? (e.g., if all tags are removed)

### Checklist:
- [ ] Search input is sanitized (no SQL injection via tsvector)
- [ ] Empty search handled gracefully
- [ ] Special characters in search don't crash
- [ ] Papers with zero tags are still discoverable (by title, author, full text)
- [ ] Only published papers appear in public search
- [ ] Tag slugs are deterministic and URL-safe
- [ ] Search handles Unicode correctly (author names in non-Latin scripts)

---

## Dimension 7: Access Control Boundaries

**Question: Can a user access data they shouldn't, or perform actions beyond their role?**

- Check `src/lib/middleware/with-role.ts` — how are roles enforced?
- Check `src/lib/middleware/with-session.ts` — session verification
- Check: Can an unauthenticated user:
  - Submit a paper? Submit a review? Leave a note? Toggle a favourite?
  - Access the editorial dashboard? (`src/app/dashboard/page.tsx`)
  - Trigger a status transition?
- Check: Can a regular user:
  - Access editorial actions? (status transitions, reviewer assignment)
  - Edit someone else's paper? Delete someone else's note?
  - See papers that are still under review (not yet published)?
- Check: Can a reviewer:
  - Review their own paper?
  - See other reviewers' reviews before submitting their own?

### Checklist:
- [ ] All write actions require authentication
- [ ] Editorial actions (status transitions, reviewer assignment) require editor role
- [ ] Users can only edit/delete their own notes
- [ ] Reviewers cannot review their own papers
- [ ] Unpublished papers are not visible to non-editors
- [ ] Reviewer identity is hidden until reviews are public
- [ ] Role checks use middleware stack, not ad-hoc checks in handlers
- [ ] Session tokens are properly validated (not just present, but valid)

---

## Dimension 8: External System Integration

**Question: What happens when GitHub is down or returns unexpected data?**

- Check GitHub OAuth flow (`src/app/api/auth/github/route.ts`, `callback/route.ts`):
  - What if GitHub returns an error during OAuth?
  - What if the access token exchange fails?
  - What if the user profile API returns incomplete data (no email, no name)?
  - What if the user revokes OAuth permission and tries to use an existing session?
- Check file storage (`src/lib/storage.ts`):
  - What if disk is full during PDF upload?
  - What if the storage path doesn't exist?
  - What if two uploads write to the same path simultaneously?

### Checklist:
- [ ] GitHub OAuth errors return user-friendly messages (not raw error dumps)
- [ ] Incomplete GitHub profiles handled gracefully (missing email, name, avatar)
- [ ] Revoked OAuth tokens detected and session invalidated
- [ ] Storage failures don't leave partial files
- [ ] Storage path creation is atomic and handles concurrent access

---

## Step 2: Run Existing Tests

```bash
cd app && npx vitest run
```

Check coverage gaps — are the edge cases you found covered by tests?

## Step 3: Report

Produce a structured report:

### Critical (breaks core functionality or loses data)
- Description, affected file:line, reproduction steps, fix recommendation

### High (security gap, data corruption risk, or workflow breakage)
- Description, affected file:line, fix recommendation

### Medium (incorrect behaviour under uncommon conditions)
- Description, affected file:line, fix recommendation

### Low (cosmetic, defensive improvement, or documentation gap)
- Description, fix recommendation

### Passed Checks
- List edge cases that ARE correctly handled

### Scorecard

| Dimension | Score (/5) | Key Finding |
|-----------|-----------|-------------|
| Input Validation | | |
| Paper ID & Workflow | | |
| Concurrency | | |
| Data Integrity | | |
| Memory & Performance | | |
| Search & Discovery | | |
| Access Control | | |
| External Integration | | |

## Key Files Reference

| File | Edge Case Role |
|------|---------------|
| `app/src/lib/paper-id.ts` | Paper ID generation — uniqueness, rollover, race safety |
| `app/src/lib/paper-workflow.ts` | State machine — valid transitions, boundary states |
| `app/src/lib/commands/editorial.ts` | Command execution — atomicity, validation |
| `app/src/lib/commands/history.ts` | Command history — immutability |
| `app/src/lib/validation/combinators.ts` | Validation framework — completeness |
| `app/src/lib/actions/papers.ts` | Paper submission — input validation, transaction safety |
| `app/src/lib/actions/social.ts` | Social actions — idempotency, concurrency |
| `app/src/lib/actions/reviews.ts` | Review submission — duplicate handling, access control |
| `app/src/lib/actions/editorial.ts` | Editorial actions — role enforcement, state validation |
| `app/src/lib/search/sanitize.ts` | Search input sanitization — injection prevention |
| `app/src/lib/search/tsvector.ts` | Full-text search — Unicode, empty queries |
| `app/src/lib/interest-matching.ts` | Interest matching — algorithmic bounds |
| `app/src/lib/auth.ts` | Auth — session validation, token handling |
| `app/src/lib/storage.ts` | File storage — concurrent access, disk errors |
| `app/src/lib/yaml.ts` | YAML parsing — malformed input |
| `app/src/lib/middleware/with-role.ts` | Role enforcement |
| `app/src/lib/middleware/with-session.ts` | Session verification |
| `app/src/app/api/auth/github/callback/route.ts` | OAuth callback — error handling |
| `app/src/app/api/papers/[paperId]/download/route.ts` | PDF download — streaming, access control |

## Red Lines — Always Flag These

- Any paper ID generation without a DB-level unique constraint
- Any state machine transition without validation against current state
- Any `findMany` without pagination in a page component or API route
- Any server action that skips validation
- Any role check outside the middleware stack (ad-hoc in handler)
- Any search query passed unsanitized to PostgreSQL tsvector
- Any write to academic record (reviews, published papers) that allows deletion
- Any event bus handler that silently swallows errors
