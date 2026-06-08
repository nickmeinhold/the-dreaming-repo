---
name: tech-debt-audit
description: >
  Audit the journal codebase for technical debt across 6 dimensions: dead code, accidental complexity,
  cargo culting, dependency health, TODO/FIXME archaeology, and duplication. Use when: after rapid
  feature shipping, before major refactors, or for periodic hygiene checks.
---

# Technical Debt Audit — The Claude Journal

You are a senior engineer assessing the accumulated technical debt in an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. The codebase uses category-theory-inspired patterns (Result monad, validation applicative, command monoid, event functor, middleware composition). Technical debt here includes both traditional debt AND over-abstraction — a monad that serves no purpose is as costly as a missing abstraction.

## Your Mindset

Think like an engineer who just inherited this codebase. For every surface you review, ask:
- Would a new team member understand why this exists?
- Is this abstraction earning its keep, or is it complexity theater?
- Is this pattern here because it solves a problem, or because it's mathematically elegant?
- If we needed to change this, how many files would we have to touch?
- Is this complexity earning its keep?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to find and report, not fix.
- You MAY run existing tests, linting, or analysis commands
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific files or areas.

If no arguments, run a **full audit** across all 6 dimensions.

---

## Dimension 1: Dead Code & Orphaned Files

**Question: How much of this codebase is no longer reachable or used?**

- Search for exported functions/types that are never imported elsewhere
- Check for commented-out code blocks (more than 3 lines)
- Look for files that aren't imported by any other file
- Check for unused dependencies in `package.json` (installed but never imported)
- Check for orphaned test files (testing modules that no longer exist)
- Check `src/generated/prisma/` — are all generated models actually used in the app?
- Check if all components in `src/components/` are imported by at least one page

### Checklist:
- [ ] No commented-out code blocks longer than 3 lines
- [ ] No exported functions/types with zero importers
- [ ] No orphaned files (not imported by anything)
- [ ] No unused dependencies in package.json
- [ ] No orphaned test files
- [ ] All Prisma models are used in the application
- [ ] All components are mounted in at least one page

---

## Dimension 2: Accidental Complexity

**Question: Where is the codebase more complex than the problem demands?**

This is ESPECIALLY important for this codebase, which uses category-theory patterns. For each abstraction, ask: does this pattern solve a concrete problem, or is it abstraction for its own sake?

- **Result monad** (`src/lib/result.ts`): Is it used consistently, or do some paths use try/catch while others use Result? A partial monad is worse than no monad.
- **Validation applicative** (`src/lib/validation/combinators.ts`): Does it actually accumulate errors, or is it used like a simple validator? If it never collects multiple errors, a simpler approach suffices.
- **Command pattern** (`src/lib/commands/`): Does the command history provide value (undo, audit trail, replay)? Or is it ceremony around a simple DB update?
- **Event bus** (`src/lib/events/bus.ts`): Are there multiple subscribers, or is it an overcomplicated function call? An event bus with one subscriber per event is indirection, not decoupling.
- **Middleware composition** (`src/lib/middleware/builder.ts`, `stacks.ts`): Is the composition actually used to build different stacks, or is there only one stack?

Also check for:
- Abstraction layers with only one implementation
- Wrapper functions that just pass through
- Configuration that could be convention
- Indirection requiring 3+ files to understand a single operation

### Checklist:
- [ ] Result monad is used consistently (not mixed with try/catch on the same paths)
- [ ] Validation applicative actually accumulates multiple errors somewhere
- [ ] Command pattern provides concrete value (audit trail, undo, or replay)
- [ ] Event bus has multiple subscribers per event type (not 1:1 indirection)
- [ ] Middleware builder composes multiple distinct stacks (not just one)
- [ ] No single-implementation abstractions
- [ ] No 3+ file indirection chains for simple operations

---

## Dimension 3: Cargo Culting

**Question: Are there patterns copied without understanding why they exist?**

- Look for category-theory patterns applied where a simple function would suffice
- Check the test names (e.g., `state-machine.test.ts`, `role-lattice.test.ts`, `jaccard-metric.test.ts`, `slug-adjunction.test.ts`, `middleware-laws.test.ts`, `result-monad.test.ts`, `validation-applicative.test.ts`, `command-monoid.test.ts`, `event-functor.test.ts`, `auth-natural-transformation.test.ts`, `mediator-dag.test.ts`):
  - Do the tests actually verify the mathematical laws (associativity, identity, functoriality)?
  - Or do the names just sound mathematical while testing ordinary behaviour?
  - If they DO verify laws, is that verification providing regression protection?
- Check for type assertions (`as`, `as unknown as`) that suggest types don't fit actual usage
- Look for error handling copied between routes that catches errors that can't occur in context

### Checklist:
- [ ] Category-theory pattern names match actual algebraic structure
- [ ] Mathematical law tests verify real properties (not just named suggestively)
- [ ] Type assertions are documented with why they're needed
- [ ] Error handling matches actual error surface
- [ ] No design patterns applied where a function call suffices

---

## Dimension 4: Dependency Health

**Question: Are our dependencies maintained, secure, and appropriately scoped?**

Run these commands to gather data:
```bash
cd app
npm outdated 2>/dev/null || true
npm audit --json 2>/dev/null | head -100 || true
```

- Count total dependencies (dependencies + devDependencies)
- Check for dependencies that duplicate functionality
- Look for heavy dependencies pulled in for a single function
- Check for packages with no recent releases (unmaintained, >2 years)
- Check version ranges — `*` or very broad ranges are risky
- Check if lock file (`package-lock.json`) is committed and in sync

### Checklist:
- [ ] No known high/critical vulnerabilities (npm audit)
- [ ] No duplicate-functionality dependencies
- [ ] No heavy dependencies used for trivial operations
- [ ] No unmaintained packages (>2 years without release)
- [ ] No wildcard version ranges
- [ ] Lock file committed and up to date

---

## Dimension 5: TODO/FIXME Archaeology

**Question: How much deferred work is accumulating, and is any of it time-critical?**

Search for all TODO, FIXME, HACK, XXX, TEMP, TEMPORARY comments:
```bash
grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP\b" app/src/ --include="*.ts" --include="*.tsx"
```

For each found item:
- Is it blocking a feature or is it a nice-to-have?
- Is it a security concern? (e.g., "TODO: validate session", "TODO: rate limit")
- Has the surrounding code changed while the TODO remained? (stale TODO)
- Could the TODO be resolved in under 30 minutes? (quick win)

### Classify each TODO:

| Priority | Description |
|----------|-------------|
| **Critical** | Security or data integrity TODOs |
| **High** | Feature completeness TODOs that affect user-facing functionality |
| **Medium** | Quality improvements that would reduce future maintenance |
| **Low** | Nice-to-haves, optimisations, or cosmetic improvements |
| **Stale** | TODOs that no longer apply |

### Checklist:
- [ ] No security-related TODOs
- [ ] No stale TODOs (code changed but TODO remained)
- [ ] Quick-win TODOs (<30 min) are identified for batch resolution
- [ ] Total TODO count is reasonable for project maturity

---

## Dimension 6: Duplication

**Question: Where is the same logic expressed in multiple places, creating a maintenance multiplier?**

- Search for structurally similar code across server actions (`src/lib/actions/`)
- Check for repeated validation patterns across actions
- Look for similar error handling patterns across API routes
- Check for repeated Prisma query patterns
- Look for similar React component patterns (same props, same structure, different entity)
- Check: Is the middleware stack duplicated across routes, or composed centrally?

Focus on duplication that creates a **maintenance multiplier** — if you change the pattern in one place, you MUST change it in N other places or introduce a bug.

### Checklist:
- [ ] No validation logic duplicated across server actions
- [ ] No error handling patterns repeated across 3+ routes
- [ ] No Prisma query patterns repeated across 3+ actions
- [ ] React components don't have copy-paste variants
- [ ] Middleware composition is centralised (not duplicated per route)

---

## Step 2: Quantify the Debt

For each finding, estimate:
- **Interest rate**: How much additional cost does this debt incur per feature added? (Low/Medium/High)
- **Payoff effort**: How long to fix? (S = <1hr, M = 1-4hr, L = 4-16hr, XL = >16hr)
- **Risk**: What breaks if we don't fix it? (Nothing / Slow development / Potential bugs / Data loss)

---

## Step 3: Report

### Debt Summary
One paragraph: overall debt assessment. Is this codebase healthy, accumulating, or drowning? Specifically address whether the category-theory patterns are earning their keep or adding unjustified complexity.

### Scorecard

| Dimension | Score (/5) | Debt Level | Key Finding |
|-----------|-----------|------------|-------------|
| Dead Code | | | |
| Accidental Complexity | | | |
| Cargo Culting | | | |
| Dependency Health | | | |
| TODO/FIXME | | | |
| Duplication | | | |

**Scoring:**
- 5 = Minimal debt, well-maintained
- 4 = Some debt, manageable
- 3 = Notable debt, should address soon
- 2 = Significant debt, slowing development
- 1 = Critical debt, impeding progress

### Quick Wins (< 1 hour each)
- What to fix, where, estimated time

### High-Interest Debt (fix soon, it's compounding)
- Finding, affected files, interest rate, payoff effort

### Low-Interest Debt (can wait)
- Finding, risk if deferred

### Stale TODOs (remove or action)
- Each stale TODO with file:line and recommendation

### Passed Checks
- Areas where debt is well-managed

## Key Files Reference

| File | Debt Relevance |
|------|---------------|
| `app/src/lib/result.ts` | Result monad — is it used consistently? |
| `app/src/lib/validation/combinators.ts` | Validation applicative — earning its keep? |
| `app/src/lib/commands/editorial.ts` | Command pattern — provides audit trail or just ceremony? |
| `app/src/lib/commands/history.ts` | Command history — is it queried/used? |
| `app/src/lib/events/bus.ts` | Event bus — multiple subscribers or 1:1 indirection? |
| `app/src/lib/middleware/builder.ts` | Middleware composition — multiple stacks or one? |
| `app/src/lib/middleware/stacks.ts` | Middleware stacks — how many distinct stacks? |
| `app/src/lib/actions/` | Server actions — check for duplication across files |
| `app/src/components/` | React components — check for copy-paste variants |
| `app/src/__tests__/` | Tests — do mathematical names match mathematical content? |
| `app/package.json` | Dependency inventory |
