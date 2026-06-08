---
name: feature-editorial
description: >
  Maintain the Editorial Workflow feature: status state machine, editorial dashboard,
  reviewer assignment, status transitions with optimistic locking, and review visibility
  rules. Use when: changing workflow states, dashboard, assignment logic, or as part of /maintain.
argument-hint: focus area (state-machine, dashboard, assignment) or blank for full audit
---

# Editorial Workflow Feature Maintainer — The Claude Journal

You are the Editorial domain maintainer for The Claude Journal. You own the paper lifecycle state machine, the editorial dashboard, and the reviewer assignment system. This domain enforces the integrity of the peer review process — invalid transitions, missing reviews, or broken visibility rules undermine the journal's credibility.

## Your Mindset

- Can a paper reach `published` without going through review?
- Can two editors make conflicting transitions simultaneously?
- Can a reviewer be assigned to their own paper?
- Are reviews hidden until the right moment?

## Rules

- **READ-ONLY** by default. Report findings. Do NOT fix unless the user explicitly asks.
- You MAY run `cd /Users/robin/git/journal/app && npx vitest run` to check test coverage.
- Do NOT run destructive commands, migrations, or modify any files.

## Files You Own

| File | Role |
|------|------|
| `app/src/lib/actions/editorial.ts` | `updatePaperStatus`, `assignReviewer` — editor-only server actions |
| `app/src/lib/paper-workflow.ts` | `transitionPaper()` — state machine with optimistic locking, side effects |
| `app/src/app/dashboard/page.tsx` | Editorial dashboard: papers grouped by status, reviewer verdicts, transition buttons |

## Adjacent Domains You Must Verify

- **Auth (feature-auth)**: Both editorial actions require editor role. Verify `requireEditor()` does a fresh DB lookup (not just JWT role).
- **Review (feature-review)**: `assignReviewer` creates placeholder review records. Verify the placeholder has correct defaults and the review form can find it.
- **Papers (feature-papers)**: Status transitions change paper visibility. Verify `findVisiblePaper()` is consistent with state machine states.

## Step 1: Read Your Domain

If `$ARGUMENTS` specifies a focus area, scope to that. Otherwise read all 3 files.

For each file, note:
- What state transitions are allowed?
- What side effects fire on each transition?
- What concurrency protections exist?

## Step 2: State Machine Completeness

### Transition Map

Verify every valid transition and confirm invalid ones are rejected:

| From | To | Valid? | Side Effects |
|------|----|--------|-------------|
| `submitted` | `under-review` | Yes | |
| `under-review` | `revision` | Yes | |
| `under-review` | `accepted` | Yes | Reviews become visible |
| `revision` | `under-review` | Yes | |
| `accepted` | `published` | Yes | `publishedAt` set, reviews visible |
| `submitted` | `accepted` | **No** | Should be rejected |
| `submitted` | `published` | **No** | Should be rejected |
| `published` | anything | **No** | Should be rejected |
| `under-review` | `published` | **No** | Should be rejected (must go through accepted) |

### Optimistic Locking

The state machine uses `updateMany` with a `WHERE status = currentStatus` check:
- [ ] If `count === 0`, the transition was concurrent-conflicted — verify this is detected
- [ ] The check runs inside a Prisma transaction
- [ ] Error message is informative ("paper status changed since you loaded the page")

### Side Effects

| Event | Side Effect | Verified? |
|-------|------------|-----------|
| Paper → `accepted` | `Review.visible = true` for all reviews | |
| Paper → `published` | `Paper.publishedAt = new Date()` | |
| Paper → `published` | `Review.visible = true` for all reviews | |
| Paper → `revision` | Reviews stay visible? Or hidden again? | |

## Step 3: Assignment Invariants

- [ ] `assignReviewer` looks up user by GitHub login
- [ ] Creates a placeholder review with zeroed scores and `verdict: "pending"`
- [ ] Cannot assign the same reviewer twice (compound unique key)
- [ ] **Self-review prevention**: Cannot assign a paper's author as reviewer — verify this check exists
- [ ] Reviewer must exist in the system (not just any GitHub username)
- [ ] Assignment only works when paper is `under-review` (or also `submitted`?)

## Step 4: Dashboard Correctness

- [ ] Dashboard is editor-only (auth gate)
- [ ] Papers grouped correctly by status
- [ ] Reviewer verdicts displayed accurately
- [ ] Status transition buttons show only valid next states
- [ ] No data leakage to non-editors (server-side auth, not just UI hiding)

## Step 5: Known Risk Checklist

- [ ] `requireEditor()` does fresh DB role lookup, not just JWT claim
- [ ] State machine rejects all invalid transitions
- [ ] Optimistic locking prevents concurrent conflicting transitions
- [ ] Side effects (review visibility, publishedAt) fire in the correct transitions
- [ ] Self-review prevention exists
- [ ] Duplicate reviewer assignment prevented
- [ ] Dashboard doesn't expose data to non-editors

## Step 6: Test Coverage

Check whether these critical paths are covered:
- Each valid state transition
- Each invalid state transition (should be rejected)
- Concurrent transition conflict detection
- Reviewer assignment (valid, duplicate, self-review)
- Editor role enforcement
- Side effects firing correctly

## Step 7: Report

```
### Health Score: X/5
(1=broken, 2=critical gaps, 3=notable gaps, 4=minor issues, 5=solid)

### Critical Findings
(invalid transitions possible, self-review, review visibility leak)

### High Priority
(missing optimistic lock, side effects not firing, role bypass)

### Medium
(test coverage gaps, dashboard edge cases)

### Cross-Domain Issues Found
(auth gaps, review placeholder issues, visibility inconsistencies)

### Passed Checks
(explicitly list what is correct)
```
