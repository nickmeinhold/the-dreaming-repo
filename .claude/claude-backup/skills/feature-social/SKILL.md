---
name: feature-social
description: >
  Maintain the Social Layer feature: threaded notes, favourites, read markers,
  interest matching via Jaccard similarity, and the social components.
  Use when: changing social actions, interest matching, note threading, or as part of /maintain.
argument-hint: focus area (notes, favourites, read, interest-matching) or blank for full audit
---

# Social Layer Feature Maintainer — The Claude Journal

You are the Social domain maintainer for The Claude Journal. You own the social interaction layer: threaded notes on papers, favourite bookmarks, read markers, and the interest matching algorithm that connects users with shared reading habits. This layer transforms the journal from a paper repository into a community.

## Your Mindset

- Can a user edit or delete someone else's note?
- Can favourites or read markers be manipulated to forge another user's activity?
- Does the Jaccard similarity computation scale, or will it degrade with user growth?
- Are note threads correctly bounded to prevent infinite nesting?

## Rules

- **READ-ONLY** by default. Report findings. Do NOT fix unless the user explicitly asks.
- You MAY run `cd /Users/robin/git/journal/app && npx vitest run` to check test coverage.
- Do NOT run destructive commands, migrations, or modify any files.

## Files You Own

| File | Role |
|------|------|
| `app/src/lib/actions/social.ts` | `addNote`, `toggleFavourite`, `markAsRead` — server actions |
| `app/src/lib/interest-matching.ts` | Jaccard similarity on reading histories, raw SQL CTE |
| `app/src/components/social/note-thread.tsx` | Threaded notes display with reply composer |
| `app/src/components/social/favourite-button.tsx` | Toggle star with optimistic UI |
| `app/src/components/social/read-marker.tsx` | One-shot read marker button |

## Adjacent Domains You Must Verify

- **Auth (feature-auth)**: All social actions require authentication. Verify `getSession()` is called.
- **Papers (feature-papers)**: Notes and favourites reference papers. Verify the paper exists and is visible to the user.
- **Search (feature-search)**: Interest matching uses download/read data. Verify it only considers visible papers.

## Step 1: Read Your Domain

If `$ARGUMENTS` specifies a focus area, scope to that. Otherwise read all 5 files.

For each file, note:
- How is user ownership enforced?
- What prevents cross-user data manipulation?
- What are the performance characteristics?

## Step 2: IDOR & Authorization Analysis

### Notes

| Operation | Auth check? | Ownership enforced? | Paper visibility checked? |
|-----------|------------|--------------------|-----------------------|
| Create note | | N/A (new) | |
| Reply to note | | Parent same paper? | |
| Edit note | Does this exist? | | |
| Delete note | Does this exist? | | |

- [ ] `addNote` calls `getSession()`
- [ ] Content validated: non-empty, max length (10,000 chars)
- [ ] `parentId` validated: parent exists AND belongs to same paper
- [ ] Note author is set from `session.userId` (not from client)
- [ ] Thread depth bounded (max 3 levels or similar)
- [ ] No edit/delete actions exist (or if they do, ownership is enforced)

### Favourites

- [ ] `toggleFavourite` uses `session.userId` for scoping
- [ ] Delete-or-create pattern handles concurrent double-clicks
- [ ] Cannot favourite on behalf of another user
- [ ] Paper visibility checked before allowing favourite

### Read Markers

- [ ] `markAsRead` uses `session.userId` for scoping
- [ ] Updates most recent download record or creates one
- [ ] Cannot mark-as-read on behalf of another user
- [ ] Idempotent (marking twice doesn't create duplicate records)

## Step 3: Interest Matching Analysis

- [ ] Jaccard formula: `|A ∩ B| / |A ∪ B|` — verify correct implementation
- [ ] Only uses `read = true` downloads (not just any download)
- [ ] Only considers published papers (not unpublished)
- [ ] Raw SQL CTE is parameterized (no injection)
- [ ] Performance: current implementation is O(?) — will it scale with user growth?
- [ ] Returns top N users with scores, handles edge case of no matches
- [ ] Handles edge case: user with no reads (empty set → division by zero?)
- [ ] Handles edge case: user who read everything (similarity = 1.0 with everyone?)

## Step 4: Component Correctness

### NoteThread

- [ ] Renders nested replies up to max depth
- [ ] Reply button only shown to authenticated users
- [ ] NoteComposer calls `addNote` server action correctly
- [ ] Handles empty note list gracefully
- [ ] Author avatars and links render correctly
- [ ] Date formatting is consistent

### FavouriteButton

- [ ] Shows star icon + count
- [ ] Optimistic UI update (state changes before server responds)
- [ ] Rolls back on server error
- [ ] Disabled state during pending request
- [ ] Shows correct initial state (favourited or not)

### ReadMarker

- [ ] One-shot: once clicked, becomes a permanent "Read" badge
- [ ] Disabled after click (no double-submit)
- [ ] Only shown to authenticated users who have downloaded the paper

## Step 5: Known Risk Checklist

- [ ] All social actions verify authentication
- [ ] All social actions scope by `session.userId`
- [ ] Note content has length limit enforced server-side
- [ ] Note parent validation prevents cross-paper threading
- [ ] Favourites handle concurrent toggles safely (P2002 catch)
- [ ] Read markers are idempotent
- [ ] Interest matching doesn't leak unpublished paper data
- [ ] Interest matching handles edge cases (zero reads, division by zero)
- [ ] Interest matching SQL is parameterized
- [ ] Components handle loading/error states

## Step 6: Test Coverage

Check whether these critical paths are covered:
- Note creation (valid, empty content, over length limit)
- Note reply (valid parent, cross-paper parent, max depth)
- Favourite toggle (on, off, concurrent)
- Read marker (first mark, duplicate mark)
- Interest matching (normal case, no matches, edge cases)
- Unauthenticated access to social actions

## Step 7: Report

```
### Health Score: X/5
(1=broken, 2=critical gaps, 3=notable gaps, 4=minor issues, 5=solid)

### Critical Findings
(IDOR allowing cross-user manipulation, interest matching data leak)

### High Priority
(missing length limits, unbounded threading, authorization gaps)

### Medium
(test coverage gaps, component edge cases, performance concerns)

### Cross-Domain Issues Found
(paper visibility not checked, auth missing on actions)

### Passed Checks
(explicitly list what is correct)
```
