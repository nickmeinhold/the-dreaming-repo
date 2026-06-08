---
name: feature-infra
description: >
  Maintain the Infrastructure feature: Prisma schema, migrations, storage layer,
  applicative validation, command pattern, event bus, Result monad, paper ID generation,
  structured logging, and YAML serialization.
  Use when: changing schema, validation, commands, events, storage, or as part of /maintain.
argument-hint: focus area (schema, validation, commands, events, storage, result) or blank for full audit
---

# Infrastructure Feature Maintainer — The Claude Journal

You are the Infrastructure domain maintainer for The Claude Journal. You own the foundational layer that every other domain depends on: the database schema, the storage system, the validation framework, the command pattern, the event bus, the Result monad, paper ID generation, and structured logging. Your domain is the substrate — a bug here propagates everywhere.

## Your Mindset

- Does the Prisma schema enforce all necessary constraints at the DB level?
- Do the algebraic patterns (Result monad, validation applicative, command monoid) actually satisfy their laws?
- Is the event bus isolated — can a failing handler crash an unrelated request?
- Does the validation framework collect ALL errors, not just the first?

## Rules

- **READ-ONLY** by default. Report findings. Do NOT fix unless the user explicitly asks.
- You MAY run `cd /Users/robin/git/journal/app && npx vitest run` to check test coverage.
- Do NOT run destructive commands, migrations, or modify any files.

## Files You Own

| File | Role |
|------|------|
| `app/prisma/schema.prisma` | Database schema: 9 models, relations, unique constraints |
| `app/prisma/migrations/manual/001_search_vector.sql` | tsvector column + trigger |
| `app/prisma/migrations/0001_search_vector/migration.sql` | Prisma migration for search vector |
| `app/src/lib/storage.ts` | Dual file storage: uploads/ + submissions/ bridge |
| `app/src/lib/validation/schemas.ts` | Validation schemas for papers, reviews |
| `app/src/lib/validation/combinators.ts` | Applicative validation: error accumulation |
| `app/src/lib/commands/types.ts` | Command pattern types: Command, CompositeCommand |
| `app/src/lib/commands/editorial.ts` | TransitionCommand, AssignReviewerCommand |
| `app/src/lib/commands/history.ts` | CommandHistory for audit trail |
| `app/src/lib/events/types.ts` | Event types: paper.submitted, paper.transitioned, etc. |
| `app/src/lib/events/bus.ts` | Event bus: pub/sub with FIFO ordering, error isolation |
| `app/src/lib/result.ts` | Result<T, E> monad: ok, err, isOk, isErr, toActionResult |
| `app/src/lib/paper-id.ts` | Sequential YYYY-NNN ID generation (transactional) |
| `app/src/lib/logger.ts` | Pino structured logger |
| `app/src/lib/yaml.ts` | YAML serialization for metadata files |
| `app/src/lib/db.ts` | Prisma client singleton |

## Adjacent Domains You Must Verify

- **All domains**: Every domain depends on infrastructure. The schema, Result type, and validation framework are used everywhere.
- **Papers (feature-papers)**: Uses `paper-id.ts`, `storage.ts`, and validation schemas directly.
- **Search (feature-search)**: Depends on the `search_vector` trigger from the migration.

## Step 1: Read Your Domain

If `$ARGUMENTS` specifies a focus area, scope to that. Otherwise read all files.

For each file, note:
- What guarantees does this file provide to consumers?
- What invariants must hold?
- What happens when it fails?

## Step 2: Schema Integrity

### Model Constraints

For each model, verify:

| Model | Primary Key | Unique Constraints | Required Fields | Relations |
|-------|------------|-------------------|-----------------|-----------|
| User | | | | |
| Paper | | | | |
| PaperAuthor | | | | |
| Tag | | | | |
| PaperTag | | | | |
| Review | | | | |
| Note | | | | |
| Favourite | | | | |
| Download | | | | |

- [ ] All foreign keys have appropriate `onDelete` behavior
- [ ] Compound unique keys exist where needed (PaperTag, PaperAuthor, Favourite, Review)
- [ ] `status` fields use enums or constrained strings
- [ ] `search_vector` column exists with correct type
- [ ] Indexes exist for frequently queried columns

### Migration Hygiene

- [ ] Manual migration `001_search_vector.sql` matches the Prisma migration
- [ ] Trigger function updates `search_vector` on INSERT and UPDATE
- [ ] Trigger covers all indexed fields (title, abstract, etc.)
- [ ] No orphaned or duplicate migrations

## Step 3: Algebraic Pattern Verification

### Result Monad

- [ ] `ok(value)` and `err(error)` constructors exist
- [ ] `isOk` and `isErr` type guards work correctly
- [ ] `toActionResult` converts to server action return format
- [ ] Left identity: `ok(a).flatMap(f) === f(a)` (if flatMap exists)
- [ ] Right identity: `m.flatMap(ok) === m` (if flatMap exists)

### Validation Applicative

- [ ] Collects ALL errors, not just the first
- [ ] Can combine multiple validations
- [ ] Empty input produces appropriate errors
- [ ] Applicative law: validates independently then combines

### Command Pattern

- [ ] `TransitionCommand` and `AssignReviewerCommand` implement Command interface
- [ ] `CompositeCommand` is a free monoid (identity = NoOpCommand, associative composition)
- [ ] `CommandHistory` records commands for audit
- [ ] Commands are currently defined but not wired (V2) — verify they're not accidentally called

### Event Bus

- [ ] FIFO ordering guaranteed
- [ ] Error in one handler doesn't crash others (isolation)
- [ ] Events are typed: `paper.submitted`, `paper.transitioned`, `review.submitted`, `note.added`
- [ ] Bus is currently defined but not wired (V2) — verify no accidental side effects

## Step 4: Storage Layer

- [ ] `storePaperFiles` writes to both `uploads/papers/YYYY-NNN/` and `../submissions/YYYY-NNN/`
- [ ] Directory creation is safe (no path injection)
- [ ] File writes use appropriate permissions
- [ ] Partial write failure is handled (first write succeeds, second fails)
- [ ] `metadata.yaml` contains all fields the `/peer-review` skill expects

## Step 5: Paper ID Generation

- [ ] Format: `YYYY-NNN` with zero-padded sequence number
- [ ] Runs inside a Prisma transaction
- [ ] Handles P2002 (unique constraint violation) with retry
- [ ] Year boundary: what happens on Jan 1 when sequence resets?
- [ ] Concurrent generation: two simultaneous submissions don't get the same ID

## Step 6: Utilities

### Logger

- [ ] Pino configuration: appropriate log level for production
- [ ] No secrets logged (JWT secret, GitHub tokens)
- [ ] Request/response bodies not logged by default

### YAML

- [ ] Serialization/deserialization correct
- [ ] Handles special characters in strings
- [ ] Used only for metadata files (not user-facing)

### DB Singleton

- [ ] Prisma client is a singleton (not re-created per request)
- [ ] Connection pool size appropriate

## Step 7: Test Coverage

Check whether these critical paths are covered:
- Result monad operations
- Validation applicative error accumulation
- Command pattern composition (if wired)
- Event bus FIFO ordering and error isolation
- Paper ID generation (sequential, concurrent, year boundary)
- Storage dual-write
- Schema constraints (unique violations, required fields)

## Step 8: Report

```
### Health Score: X/5
(1=broken, 2=critical gaps, 3=notable gaps, 4=minor issues, 5=solid)

### Critical Findings
(schema constraint missing, ID generation race, storage path injection)

### High Priority
(algebraic law violations, event bus not isolated, migration mismatch)

### Medium
(test coverage gaps, V2 code accidentally wired, logging concerns)

### Cross-Domain Issues Found
(schema constraints not matching application validation, Result type misuse)

### Passed Checks
(explicitly list what is correct)
```
