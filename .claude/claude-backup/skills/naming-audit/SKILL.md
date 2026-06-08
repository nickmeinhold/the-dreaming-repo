---
name: naming-audit
description: >
  Audit the codebase for naming consistency, domain language alignment, and semantic clarity.
  Checks that the same concept uses the same word everywhere, that names don't lie about what
  they do, and that mathematical pattern names match their actual algebraic structure.
  Use when: onboarding new contributors, after rapid development, or when domain confusion emerges.
---

# Naming Audit — The Claude Journal

You are a senior engineer and domain modeling expert auditing the naming conventions of an academic journal platform for AI and human authors. Good names are the cheapest documentation. Bad names are the most expensive bugs — they cause contributors to make wrong assumptions, build on misunderstandings, and introduce subtle errors that pass review because the name "makes sense" even though it doesn't match reality.

This codebase has a second naming dimension: mathematical structure names (monoids, functors, natural transformations). These must be assessed for accuracy — calling something a "monad" when it isn't creates false expectations about its algebraic behaviour.

## Your Mindset

Think like a contributor seeing this codebase for the first time. For every name you encounter, ask:
- If I only read this name and nothing else, would I correctly guess what it does/contains?
- Is this the same word used everywhere else for this concept?
- Does this name lie? (Says one thing, does another)
- If a mathematical name is used, does the implementation actually satisfy those laws?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to find and report, not fix.
- You MAY run search commands to check usage patterns
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific files or areas.

If no arguments, run a **full audit** across all 5 dimensions.

---

## Dimension 1: Ubiquitous Language — Domain Term Consistency

**Question: Does the codebase use the same words everywhere for the same concept?**

### Domain Terms Inventory

| Domain Concept | Expected Term | Check for alternatives |
|---------------|--------------|----------------------|
| A submitted work | `paper` | `submission`, `article`, `manuscript`, `document`, `work` |
| A person using the platform | `user` | `author`, `member`, `account`, `person`, `profile` |
| An AI with persistent identity | `autonomous` (author type) | `ai`, `agent`, `instance`, `bot` |
| The act of submitting | `submission` | `upload`, `submit`, `paper creation` |
| Changing paper status | `transition` | `change`, `update`, `move`, `advance`, `progress` |
| A written evaluation | `review` | `assessment`, `evaluation`, `critique`, `feedback` |
| A comment on a paper | `note` | `comment`, `annotation`, `remark`, `discussion` |
| Bookmarking a paper | `favourite` | `bookmark`, `star`, `like`, `save` |
| The editorial workflow | `workflow` | `pipeline`, `process`, `flow`, `lifecycle` |
| Paper identifier | `paperId` | `id`, `submissionId`, `paperNumber`, `code` |
| Topic label | `tag` | `label`, `topic`, `category`, `keyword`, `subject` |

For each domain concept, search for alternative terms and flag inconsistencies.

### Checklist:
- [ ] Each domain concept uses one term consistently across the codebase
- [ ] Code terms match Prisma model names (Paper, Review, Note, Favourite, Tag, User, Download)
- [ ] UI-facing text matches code terms
- [ ] Comments and error messages use the same terms as the code
- [ ] `metadata.yaml` field names match code terms

---

## Dimension 2: Mathematical Structure Names

**Question: Do the mathematical names in this codebase accurately describe the algebraic structure?**

This is unique to this project. Audit each mathematical claim:

| Name Used | File | Verify |
|-----------|------|--------|
| Result monad | `result.ts`, `result-monad.test.ts` | Does it satisfy left identity, right identity, associativity of bind? |
| Validation applicative | `validation/combinators.ts` | Does it accumulate errors via applicative apply? Is `<*>` defined? |
| Command monoid | `commands/`, `command-monoid.test.ts` | Is there an identity command and associative composition? |
| Event functor | `events/`, `event-functor.test.ts` | Does mapping preserve identity and composition? |
| Middleware composition | `middleware/`, `middleware-laws.test.ts` | Is composition associative with identity middleware? |
| Role lattice | `with-role.ts`, `role-lattice.test.ts` | Is there a partial order with join/meet? |
| Slug adjunction | tag↔slug, `slug-adjunction.test.ts` | Is there a Galois connection / adjoint pair? |
| Jaccard metric | `interest-matching.ts` | Does it satisfy metric axioms? (It's a semi-metric: Jaccard distance satisfies triangle inequality) |
| Natural transformation | `auth/adapter.ts` | Does the adapter commute with functorial structure? |
| Mediator DAG | `submission/mediator.ts` | Is the dependency graph actually acyclic? |
| Immutable monoid | `immutable-monoid.test.ts` | What structure is this? Is it correctly named? |

For each:
- If the name is accurate: good, document it
- If the name is approximately right (captures the spirit but not the letter): note the discrepancy
- If the name is misleading (the structure doesn't satisfy the claimed laws): flag as a lying name

### Checklist:
- [ ] Every mathematical name corresponds to the correct algebraic structure
- [ ] Tests verify the actual laws (not just named after them)
- [ ] Mathematical naming is consistent (don't call it a monad in one place and a functor elsewhere)
- [ ] Contributors unfamiliar with category theory can still understand the code from behaviour

---

## Dimension 3: Function & Method Names

**Question: Does each function name accurately describe what it does?**

### Names That Lie
- `get*` functions that modify state (should be `fetch*` or `load*` if side effects)
- `create*` functions that also update or upsert
- `validate*` functions that also transform data
- `check*` functions that throw (should be `assert*` or `ensure*`)
- `is*`/`has*` functions that return non-boolean values

### Names That Are Too Vague
- `handle*` — handle how?
- `process*` — process what?
- `data`, `info`, `result`, `item` — of what?

### Checklist:
- [ ] `get*` functions don't modify state
- [ ] `create*` functions only create, don't upsert
- [ ] `validate*` functions don't transform data
- [ ] No `handle*`/`process*` without specificity
- [ ] Function names are verbs, type names are nouns

---

## Dimension 4: File & Directory Names

**Question: Can I find the file I'm looking for without searching?**

- Check: Do file names match their primary export?
- Check: Are file names consistent? (kebab-case?)
- Check: Do directory names reflect purpose?
  - `lib/` for utilities
  - `lib/actions/` for server actions
  - `lib/middleware/` for middleware
  - `lib/commands/` for command pattern
  - `lib/events/` for event bus
  - `lib/search/` for search
  - `lib/validation/` for validation
  - `lib/auth/` for auth
  - `lib/submission/` for submission mediator
  - `components/` for React components
  - `generated/` for Prisma generated code
- Check: Are test files named to match their source files?
  - Source: `paper-workflow.ts` → Test: `state-machine.test.ts` (mismatch! Is this intentional?)
  - Source: `interest-matching.ts` → Test: `jaccard-metric.test.ts` (mismatch!)
  - Source: `result.ts` → Test: `result-monad.test.ts` (adds "monad" — intentional?)

### Checklist:
- [ ] File names match primary export
- [ ] Consistent naming convention
- [ ] Test file names map clearly to source files
- [ ] Directory structure reflects architectural boundaries

---

## Dimension 5: Error Messages & User-Facing Text

**Question: When something goes wrong, does the message help the user fix it?**

- Check error messages in server actions and API routes
- Check: Are error messages actionable?
- Check: Do error messages use domain language? ("Paper not found" vs "Entity not found")
- Check: Are validation errors specific? ("Title is required" vs "Validation failed")
- Check: Are state machine transition errors clear? ("Cannot accept paper: still under review" vs "Invalid transition")
- Check portal-facing messages — authors and reviewers see these

### Checklist:
- [ ] Error messages use domain language
- [ ] Error messages are actionable
- [ ] Validation errors specify which field failed
- [ ] State machine errors describe current state and attempted action
- [ ] No technical jargon in user-facing messages (no Prisma error codes)

---

## Step 2: Cross-Reference

- Read Prisma schema for canonical model names
- Read `templates/metadata-template.yaml` for canonical field names
- Check `CLAUDE.md` for documented domain terminology

---

## Step 3: Report

### Summary
One paragraph: overall naming health. Is the codebase speaking one language or several? Are the mathematical names earning their keep or creating confusion?

### Scorecard

| Dimension | Score (/5) | Key Finding |
|-----------|-----------|-------------|
| Domain Consistency | | |
| Mathematical Names | | |
| Function Names | | |
| File Names | | |
| Error Messages | | |

### Domain Language Violations
Same concept with multiple names.

### Mathematical Name Assessment

| Name | Accurate? | Evidence | Recommendation |
|------|-----------|----------|----------------|
| Result monad | | | |
| Validation applicative | | | |
| ... | | | |

### Lying Names
Functions/variables whose names don't match behaviour.

### File↔Test Name Mismatches
Source files whose test files have non-obvious names.

### Error Message Issues
Messages that confuse rather than help.

### Passed Checks
Areas with excellent naming.

### Glossary
Recommended canonical terms:

| Concept | Canonical Term | Avoid |
|---------|---------------|-------|
| ... | ... | ... |

## Key Files Reference

| File | Naming Role |
|------|------------|
| `app/src/lib/result.ts` | Result monad — check if name matches structure |
| `app/src/lib/validation/combinators.ts` | Validation applicative — check if name matches |
| `app/src/lib/commands/editorial.ts` | Command pattern — naming of commands |
| `app/src/lib/events/bus.ts` | Event bus — event naming |
| `app/src/lib/paper-workflow.ts` | State machine — state/transition naming |
| `app/src/lib/middleware/with-role.ts` | Role lattice — role naming |
| `app/src/lib/actions/` | Server actions — domain term usage |
| `app/src/components/` | React components — user-facing naming |
| `app/src/__tests__/` | Test files — mathematical name accuracy |
| `templates/metadata-template.yaml` | Canonical metadata field names |
