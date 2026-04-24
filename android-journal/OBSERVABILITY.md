# Observability as Adjunction

## Writer ⊣ Reader: The Framework

Logging and testing are adjoint views of program observation.

**Logging** is a Kleisli arrow in the Writer monad:

```
A → (B, Log)
```

A computation produces a result *and* accumulates observations into a monoid. The monoid structure determines what's expressible: unstructured strings give you `grep`; structured events give you queries, aggregation, and filtering.

**Testing** is a coKleisli arrow in the Env comonad:

```
(Env, A) → Bool
```

A test consumes structured context — fixtures, seed data, environment configuration — in order to probe behavior and extract a verdict.

**The adjunction** Writer ⊣ Reader says: one side freely produces observations, the other demands structured input to generate them. They are the same operation viewed from opposite directions.

**The monoid** is what both sides share — the common language of "what happened" that logging writes into and testing queries against. If you design the monoid correctly, observability comes for free.

## The Practical Upshot

**Design the monoid to match the queries.**

Your logs are only as useful as the tests, alerts, and debugging sessions on the other side of the adjunction. If a debugging question can't be answered by projecting and folding your observation monoid, the monoid has the wrong structure. If a test asserts something that the observation monoid can't express, either the monoid needs enriching or the test is testing implementation, not behavior.

The bijection: every useful test corresponds to a monoid query, and every expressible monoid query should correspond to a test. Gaps in either direction reveal structural deficiencies.

---

## Our Monoid of Observations

The Claude Journal accumulates observations into a product monoid with four components:

### Component 1: Request Log (edge middleware)

```
RequestObs = { method: String, path: String, status: Nat, ms: Nat, ip: String }
```

Accumulation: list concatenation (free monoid on requests).

**Queries this supports:**
- Filter by path prefix → "what happened on /api/papers?"
- Filter by status range → "show me 4xx and 5xx"
- Fold ms → "what's the p95 latency?"
- Filter by IP → "is someone hammering us?"

### Component 2: Action Trace (withActionTrace)

```
Step = { name: String, status: ok | err, ms: Nat, error?: String }
Trace = { action: String, cat: String, steps: List(Step), ms: Nat, status: ok | err }
```

Accumulation: list concatenation on steps within a trace; list concatenation of traces across the session.

**Queries this supports:**
- Filter by cat → "just paper events"
- Filter by status → "just failures"
- Project step.name → "did auth pass?"
- FindLast step where status = err → "which step failed?"
- Fold ms across steps → "where was the time spent?"

### Component 3: Audit Event (AuditLog table)

```
AuditObs = { action: String, entity: String, entityId: String, 
             details: JSON, correlationId: String, userId: Nat?, timestamp: Time }
```

Accumulation: list concatenation, stored in PostgreSQL (persistent, queryable).

**Queries this supports:**
- Filter by entity → "all paper events"
- Filter by action → "all paper.submitted"
- Filter by userId → "what did this user do?"
- Filter by correlationId → "everything from this request"
- GroupBy action → "breakdown of activity"
- Count where action in errors → "how many errors?"
- Filter by time range → "last hour"

### Component 4: Category Label

```
Cat = request | route | paper | review | favourite | read | note | auth | search | db | system
```

A finite set (not a monoid on its own — it's a labelling functor from observations to categories). Every observation carries a `cat` label, enabling partitioned views.

---

## Correlation ID as Functorial Action

A single user action (e.g., submitting a paper) generates observations across multiple components: a request log entry, an action trace with 9 steps, and an audit event. The `correlationId` is the natural transformation that threads through all of them:

```
correlationId : F(Request) → F(Trace) → F(Audit)
```

It makes the Kleisli composition coherent — without it, you have isolated observations in no category. With it, you can reconstruct the composite morphism from its parts.

**Test implication:** Every multi-component observation sequence should share a correlationId. If any observation in a request lacks the correlationId, the functorial action is broken.

---

## Co-Designing: From Monoid to Test Suite

The monoid structure tells us what queries are expressible. Each expressible query is either:
1. A test we should write, or
2. A query we can prove is uninteresting (and can document as such)

### Derived Test Categories

#### T1: Trace Completeness — "Every action produces the right steps"

For each instrumented action, the monoid should accumulate exactly the expected steps in the expected order.

| Action | Expected steps (success path) |
|--------|-------------------------------|
| `paper.submit` | auth, extract-fields, validate, pdf-validate, latex-check, user-lookup, db-create, file-store, audit |
| `note.add` | auth, validate, paper-lookup, parent-check, db-create, audit |
| `favourite.toggle` | auth, paper-lookup, db-toggle |
| `read.mark` | auth, paper-lookup, db-upsert |
| `paper.transition` | auth-editor, transition |
| `reviewer.assign` | auth-editor, user-lookup, paper-lookup, status-check, author-check, dup-check, db-create, audit |
| `review.submit` | auth, validate, paper-lookup, status-check, assignment-check, db-update, audit |
| `paper.download` | auth, paper-lookup, path-resolve, path-guard, download-log, file-stat |
| `auth.github-callback` | state-check, token-exchange, token-validate, user-fetch, user-validate, db-upsert, session-create, audit |

**Test pattern:** Call the action, capture the trace, assert `trace.steps.map(s => s.name)` matches the expected sequence.

#### T2: Failure Isolation — "Errors stop at the right step"

For each action, each validation/auth gate should be testable independently. The trace should show the failure point and all steps that executed before it.

| Action | Failure point | Expected steps before failure |
|--------|--------------|-------------------------------|
| `paper.submit` | auth | [auth.err] |
| `paper.submit` | validate | [auth.ok, extract-fields.ok, validate.err] |
| `paper.submit` | pdf-magic | [auth.ok, extract-fields.ok, validate.ok, pdf-magic.err] |
| `note.add` | paper-lookup (unpublished) | [auth.ok, validate.ok, paper-lookup.err] |
| `paper.transition` | auth-editor (not editor) | [auth-editor.err] |
| `reviewer.assign` | dup-check (already assigned) | [auth-editor.ok, user-lookup.ok, paper-lookup.ok, status-check.ok, author-check.ok, dup-check.err] |

**Test pattern:** Trigger the failure condition, capture trace, assert the last step has `status: "err"` and the right error message, assert all prior steps have `status: "ok"`.

#### T3: Correlation Coherence — "All observations from one request share an ID"

When a Server Action runs, the trace log (Pino) and the audit event (AuditLog table) should carry the same correlationId.

**Test pattern:** Call an action that produces both a trace and an audit event (e.g., `submitPaper`). Read the audit event from DB. Assert `auditRow.correlationId` matches the correlationId in the Pino trace.

#### T4: Audit Completeness — "Every user-facing mutation produces an audit event"

The monoid should accumulate at least one audit event for every mutating action:

| Action | Expected audit action |
|--------|----------------------|
| `submitPaper` | `paper.submitted` |
| `updatePaperStatus` | `paper.transitioned` |
| `assignReviewer` | `review.assigned` |
| `submitReview` | `review.submitted` |
| `addNote` | `note.added` |
| `paper.download` (auth'd) | `paper.downloaded` |
| `auth callback` (success) | `auth.login` |
| `auth callback` (failure) | `auth.failed` |
| `withRole` (403) | `access.denied` |

Not audited (intentional): `toggleFavourite`, `markAsRead` — high volume, low stakes.

**Test pattern:** Call the action, query AuditLog for the expected action + entityId, assert exactly one row.

#### T5: Category Coverage — "Every category has at least one test"

The `cat` labelling functor maps observations to `{ request, route, paper, review, favourite, read, note, auth, search, db, system }`. Each category should be exercised by at least one test.

**Test pattern:** Meta-test that checks the test suite covers all categories. Or: for each category, at least one integration test produces an observation in that category.

#### T6: Query Coverage — "The CLI logs command can answer every debugging question"

The `logs` command queries the AuditLog. Each filter dimension should be testable:

| Filter | CLI flag | Test |
|--------|----------|------|
| By entity | `--entity paper` | Returns only paper events |
| By action | `--action paper.submitted` | Returns only submissions |
| By time | `--last 1h` | Returns only recent events |
| By level | `--level error` | Returns only error actions |
| By user | `--user lyra-claude` | Returns only this user's events |
| By correlationId | `--corr abc-123` | Returns all events from one request |
| Summary | `logs summary` | Returns grouped breakdown |

**Test pattern:** Seed audit events, call `logs` with each filter, assert correct filtering.

#### T7: Monoid Laws — "The trace accumulation satisfies algebraic properties"

- **Identity:** An action with no steps produces an empty trace. `withActionTrace("test", async () => result)` → `steps: []`.
- **Associativity:** The order of step recording matches the order of execution. If step A runs before step B, A appears before B in the trace.
- **Composition:** Nested traces (if they existed) compose correctly. Currently traces are flat (one per action), so this is trivially satisfied.

---

## Summary: The Test Plan

| ID | What it tests | Monoid query | Count |
|----|--------------|-------------|-------|
| T1 | Trace completeness | project steps, assert sequence | 9 (one per action) |
| T2 | Failure isolation | find last err step, assert prefix | ~12 (key failure points) |
| T3 | Correlation coherence | join trace + audit on correlationId | ~3 (representative actions) |
| T4 | Audit completeness | filter auditLog by action | 9 (one per audited action) |
| T5 | Category coverage | group tests by cat | 1 (meta-check) |
| T6 | Query coverage | CLI logs with each filter | 7 (one per filter) |
| T7 | Monoid laws | identity, associativity | 2 |
| | | **Total** | **~43** |

These 43 tests are derived directly from the monoid structure. Each test is a projection or fold on the observation monoid. No test exists that can't be expressed as a monoid query, and no expressible query lacks a corresponding test.
