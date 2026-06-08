---
name: test-health-audit
description: >
  Audit the test suite for pyramid health, coverage gaps, flakiness risks, and test quality.
  Evaluates unit/E2E ratio, identifies untested actions and components, and checks whether
  tests verify behaviour or just exercise code. Special attention to mathematical law tests.
  Use when: expanding test coverage, before shipping, or after rapid feature development.
---

# Test Health Audit — The Claude Journal

You are a senior QA engineer auditing the test suite of an academic journal platform built with Next.js 16, Prisma 7, PostgreSQL, and Vitest. The test suite includes an unusual feature: tests named after mathematical structures (monoids, functors, natural transformations, applicatives). Your job is to assess both conventional test health AND whether these mathematical tests provide real value.

## Your Mindset

Think like a QA lead evaluating whether this test suite actually protects the team. For every test you review, ask:
- If this test passes, what can I confidently say about the system?
- If I introduce a bug in the production code, will this test catch it?
- If this test fails, will the failure message tell me what's wrong?
- Could this test pass even when the code is broken?
- For mathematical law tests: does the test actually verify the algebraic property, or is it just named suggestively?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to assess and report, not fix.
- You MAY run existing tests to check results and timing
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific test files or areas.

If no arguments, run a **full audit** across all 5 dimensions.

---

## Dimension 1: Test Pyramid Shape

**Question: Is the test suite shaped like a pyramid or an ice cream cone?**

Count tests at each level:
```bash
cd app
# Unit/property tests
find src/__tests__ -name "*.test.ts" | wc -l
grep -r "it\(\|test(" src/__tests__/ --include="*.ts" | wc -l

# E2E tests (if any)
find . -name "*.spec.ts" -o -name "*.e2e.ts" | wc -l
```

- Calculate the ratio
- Check: Are "unit" tests actually unit tests? (No DB, no network)
- Check: Is there any integration testing? (Real DB, real API calls)
- Check: Is there any E2E testing? (Browser-based)

### Checklist:
- [ ] Unit tests exist
- [ ] Unit tests don't touch the database or network
- [ ] Integration or E2E tests exist (or are planned)
- [ ] Test ratio is appropriate for project maturity

---

## Dimension 2: Coverage Gaps

**Question: Which parts of the system have no test coverage at all?**

### Server Action Coverage
Map every server action to its test coverage:
```bash
# All server actions
grep -rn "export.*async function" app/src/lib/actions/ --include="*.ts"

# All test files
ls app/src/__tests__/
```

For each action in `src/lib/actions/`:
- Is there a test for the happy path?
- Are error paths tested? (validation failure, auth failure, not found)
- Are edge cases tested? (empty input, duplicate submission, invalid state transition)

### Library Coverage
For each module in `src/lib/`:
- `paper-id.ts` — tested? (`paper-id.test.ts` exists)
- `paper-workflow.ts` — tested? (`state-machine.test.ts` exists)
- `result.ts` — tested? (`result-monad.test.ts` exists)
- `validation/combinators.ts` — tested? (`validation-applicative.test.ts` exists)
- `commands/editorial.ts` — tested? (`command-monoid.test.ts` exists)
- `events/bus.ts` — tested? (`event-functor.test.ts` exists)
- `middleware/builder.ts` — tested? (`middleware-laws.test.ts` exists)
- `search/sanitize.ts` — tested? (`search-strategy.test.ts` exists)
- `interest-matching.ts` — tested? (`jaccard-metric.test.ts` exists)
- `auth.ts` / `auth/adapter.ts` — tested? (`auth-natural-transformation.test.ts` exists)
- `submission/mediator.ts` — tested? (`mediator-dag.test.ts` exists)
- `storage.ts` — tested?
- `yaml.ts` — tested?
- `db.ts` — tested?

### Critical Untested Paths
Flag these as high-priority if untested:
- Authentication and session management
- Paper submission end-to-end (form → action → DB → event)
- Status transition end-to-end (editorial action → state machine → command → history)
- Search with adversarial input
- Role-based access control enforcement
- PDF download with access control

### Checklist:
- [ ] Every server action has at least one test
- [ ] Auth flow has tests for valid, invalid, and expired sessions
- [ ] Paper workflow has tests for all valid transitions
- [ ] Paper workflow has tests for all INVALID transitions (rejection)
- [ ] Search has tests for edge cases (empty, special chars, SQL injection attempts)
- [ ] Role enforcement has tests
- [ ] Validation combinators tested with multiple error accumulation

---

## Dimension 3: Test Quality

**Question: Do these tests actually verify behaviour, or do they just exercise code?**

### Mathematical Law Tests — Special Assessment
This codebase has tests named after mathematical structures. For each:

| Test File | Claimed Structure | Verify: |
|-----------|------------------|---------|
| `state-machine.test.ts` | State machine | Does it test all transitions AND invalid transitions? |
| `role-lattice.test.ts` | Lattice | Does it verify partial order properties (reflexive, antisymmetric, transitive)? |
| `jaccard-metric.test.ts` | Metric | Does it verify metric axioms (non-negativity, identity, symmetry, triangle inequality)? |
| `paper-id.test.ts` | Paper ID | Does it test generation, parsing, ordering? |
| `slug-adjunction.test.ts` | Adjunction | Does it verify the adjunction (tag↔slug round-trip)? |
| `middleware-laws.test.ts` | Composition laws | Does it verify associativity and identity? |
| `immutable-monoid.test.ts` | Monoid | Does it verify associativity and identity element? |
| `result-monad.test.ts` | Monad | Does it verify left/right identity and associativity (bind laws)? |
| `validation-applicative.test.ts` | Applicative | Does it verify applicative laws and error accumulation? |
| `command-monoid.test.ts` | Monoid | Does it verify associativity and identity for command composition? |
| `event-functor.test.ts` | Functor | Does it verify identity and composition laws? |
| `auth-natural-transformation.test.ts` | Natural transformation | Does it verify naturality (commuting square)? |
| `mediator-dag.test.ts` | DAG | Does it verify acyclicity and dependency ordering? |

For each test:
- Does the mathematical property tested correspond to a real system invariant?
- If the law fails, does that indicate a real bug?
- Or is the math incidental and the test is really just a behaviour test with a fancy name?

### Assertion Quality
- Look for tests with no assertions (just `expect(result).toBeDefined()`)
- Look for tests that assert too much (brittle)
- Check: Do tests verify important properties, or just that something was returned?

### Test Independence
- Check: Do tests depend on execution order?
- Check: Do tests share mutable state?

### Negative Testing
- Are invalid inputs tested?
- Are auth failures tested?
- Are state machine violations tested?

### Checklist:
- [ ] Mathematical law tests verify actual algebraic properties
- [ ] Mathematical properties correspond to system invariants
- [ ] No tests that only assert `.toBeDefined()` or `.toBeTruthy()`
- [ ] Tests verify behaviour, not implementation details
- [ ] Tests are independent (no order dependency)
- [ ] Negative cases are tested

---

## Dimension 4: Flakiness Risk

**Question: Will these tests produce the same result every time?**

### Time Dependency
- Search for `new Date()`, `Date.now()` in test files
- Check: Are dates hardcoded or do tests depend on "now"?
- Paper IDs include the year — do tests hardcode years that will become stale?

### Network Dependency
- Check: Do any tests make real HTTP calls?
- Check: Do tests depend on GitHub API or other external services?

### Race Conditions in Tests
- Check: Do any tests use `Promise.race` or rely on timing?
- Check: Does the event bus introduce async timing issues in tests?

### Checklist:
- [ ] No tests depend on current date/time without mocking
- [ ] No tests make real network calls
- [ ] Paper ID tests don't hardcode years that will expire
- [ ] Event bus tests handle async timing correctly
- [ ] Tests pass when run in isolation

---

## Dimension 5: Test Maintainability

**Question: When the code changes, how much test code needs to change?**

### Test-to-Code Coupling
- Do tests import internal implementation details, or only public interfaces?
- Do tests duplicate production code logic?
- Are test utilities shared?

### Test Organisation
- Is the test directory structure parallel to the source?
- Are test file names consistent?
- Are test descriptions clear? (`it("should X when Y")`)

### Test Data
- Are test fixtures realistic? (Real paper titles, author names, tags)
- Are magic numbers explained?

### Checklist:
- [ ] Tests import only public interfaces
- [ ] Test helpers are shared
- [ ] Test descriptions follow `should X when Y`
- [ ] Test data is realistic

---

## Step 2: Run the Test Suite

```bash
cd app && npx vitest run 2>&1
```

Record:
- Total test count
- Pass/fail counts
- Total runtime
- Slowest tests
- Any skipped tests

---

## Step 3: Report

### Summary
One paragraph: overall test health. Special assessment of whether the mathematical law tests provide genuine regression protection or are mathematical cosplay.

### Scorecard

| Dimension | Score (/5) | Key Finding |
|-----------|-----------|-------------|
| Pyramid Shape | | |
| Coverage Gaps | | |
| Test Quality | | |
| Flakiness Risk | | |
| Maintainability | | |

### Mathematical Law Tests Assessment

| Test | Verifies Real Law? | Corresponds to System Invariant? | Value |
|------|-------------------|----------------------------------|-------|
| ... | Yes/No/Partial | Yes/No | High/Medium/Low/Theater |

### Critical Coverage Gaps
Untested paths that handle critical functionality.

### Weak Tests
Tests that exist but don't protect.

### Flakiness Risks
Tests likely to fail intermittently.

### Passed Checks
Areas with strong coverage.

### Recommended Test Additions
Prioritised by risk reduction.

## Key Files Reference

| File | Test Role |
|------|----------|
| `app/src/__tests__/state-machine.test.ts` | Paper workflow transitions |
| `app/src/__tests__/role-lattice.test.ts` | Role hierarchy properties |
| `app/src/__tests__/jaccard-metric.test.ts` | Interest matching correctness |
| `app/src/__tests__/paper-id.test.ts` | Paper ID generation/parsing |
| `app/src/__tests__/slug-adjunction.test.ts` | Tag↔slug bijection |
| `app/src/__tests__/middleware-laws.test.ts` | Middleware composition laws |
| `app/src/__tests__/immutable-monoid.test.ts` | Immutable data composition |
| `app/src/__tests__/result-monad.test.ts` | Result type monad laws |
| `app/src/__tests__/validation-applicative.test.ts` | Validation error accumulation |
| `app/src/__tests__/command-monoid.test.ts` | Command composition |
| `app/src/__tests__/event-functor.test.ts` | Event transformation laws |
| `app/src/__tests__/auth-natural-transformation.test.ts` | Auth adapter naturality |
| `app/src/__tests__/mediator-dag.test.ts` | Submission dependency ordering |
| `app/src/__tests__/search-strategy.test.ts` | Search sanitization/tsvector |
