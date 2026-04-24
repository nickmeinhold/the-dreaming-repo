# CLI Command Inventory & Test Matrix

## Complete CLI Command Inventory

Entry point: `npx tsx src/cli.ts`

```
┌───────────┬──────────────────────────────────────┐
│   Group   │               Commands               │
├───────────┼──────────────────────────────────────┤
│ health    │ health check                         │
├───────────┼──────────────────────────────────────┤
│ user      │ create, list, show, promote, similar │
├───────────┼──────────────────────────────────────┤
│ paper     │ submit, list, show, download         │
├───────────┼──────────────────────────────────────┤
│ editorial │ status, assign, dashboard            │
├───────────┼──────────────────────────────────────┤
│ review    │ submit, show                         │
├───────────┼──────────────────────────────────────┤
│ note      │ add, list                            │
├───────────┼──────────────────────────────────────┤
│ favourite │ toggle, list                         │
├───────────┼──────────────────────────────────────┤
│ read      │ mark, history                        │
├───────────┼──────────────────────────────────────┤
│ search    │ query                                │
├───────────┼──────────────────────────────────────┤
│ tag       │ list, show                           │
└───────────┴──────────────────────────────────────┘
```

**10 command groups, 22 commands total.**

## Global Options

- `--as <login>` — Act as this GitHub user (required for authenticated commands)
- `--format <format>` — Output format: `json` (default) | `table`

## Architecture

The CLI is a parallel entry point to the Next.js web app. It calls Prisma and pure business logic directly, bypassing server actions, cookies, and cache invalidation.

| Web app layer        | CLI replacement              |
|----------------------|------------------------------|
| `getSession()`       | `--as <login>` → DB lookup   |
| `FormData`           | CLI flags + `readFile()`     |
| `revalidatePath()`   | skipped (no cache)           |
| `requireEditor()`    | `resolveEditor()` → DB check |

Pure functions imported unchanged: `searchPapers()`, `findSimilarUsers()`, `transitionPaper()`, `nextPaperId()`, `storePaperFiles()`, `validatePaperSubmission()`, `validateReviewData()`, `validateNoteContent()`, `slugToLabel()`.

## Test Matrix (55 planned cases)

### Health (1)
- [ ] database connectivity

### Users (10)
- [ ] create user
- [ ] create with role
- [ ] reject invalid type
- [ ] list users
- [ ] show user with counts
- [ ] show nonexistent → error
- [ ] promote user
- [ ] reject invalid role
- [ ] similar (no reads) → empty
- [ ] similar (with reads) → results

### Papers (11)
- [ ] submit paper with PDF
- [ ] submit with LaTeX
- [ ] reject bad PDF (no magic bytes)
- [ ] reject no --as
- [ ] reject unknown user
- [ ] reject invalid category
- [ ] list (published only for non-editors)
- [ ] list with status filter as editor
- [ ] list with category filter
- [ ] show paper detail
- [ ] show nonexistent → error

### Editorial (8)
- [ ] valid status transition
- [ ] invalid transition → error
- [ ] non-editor rejected
- [ ] assign reviewer
- [ ] assign author → rejected
- [ ] assign to wrong status → rejected
- [ ] double-assign → rejected
- [ ] dashboard grouped by status

### Reviews (5)
- [ ] submit review with valid scores
- [ ] submit without assignment → rejected
- [ ] invalid scores → rejected
- [ ] show visible reviews (non-editor)
- [ ] editor sees all reviews

### Social (11)
- [ ] add note to published paper
- [ ] threaded reply
- [ ] cross-paper reply → rejected
- [ ] note on unpublished → rejected (non-editor)
- [ ] list notes
- [ ] favourite toggle on
- [ ] favourite toggle off
- [ ] list favourites
- [ ] mark as read (updates existing download)
- [ ] mark as read (creates download)
- [ ] read history

### Search & Tags (6)
- [ ] search papers
- [ ] empty query → empty results
- [ ] category filter
- [ ] tag list with counts
- [ ] tag show with papers
- [ ] tag show nonexistent → error

### Output & Error (3)
- [ ] JSON output format (default)
- [ ] table output format
- [ ] unknown command → error

## Synthetic Test Data

17 synthetic papers in `synthetic-papers/2026-001` through `2026-017/`, each containing a valid PDF (`%PDF-` magic bytes). Used by E2E tests for `paper submit` commands.

## Running Tests

```bash
# Setup test database (requires Docker postgres)
docker compose up -d db
npm run test:integration:setup

# Run CLI E2E tests
npm run test:integration

# Smoke test
npx tsx src/cli.ts health
```
