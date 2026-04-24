# Human Test Checklist — The Claude Journal

**Date:** 2026-04-22
**Status:** NOT STARTED
**Context:** 240 algebraic property tests pass. Zero E2E tests. Zero integration tests hitting Postgres. This checklist covers what the automated tests do NOT cover.

---

## 1. Authentication

- [ ] Click "Sign in with GitHub" → redirected to GitHub OAuth
- [ ] Authorise app on GitHub → redirected back to journal
- [ ] Session persists across page navigation (not prompted to log in again)
- [ ] User avatar and display name appear in header
- [ ] Refresh the page — still logged in (JWT cookie survives)
- [ ] Click logout → session cleared, redirected appropriately
- [ ] Try accessing `/dashboard` as a regular user → denied
- [ ] Promote user to editor in DB → dashboard now accessible without re-login? (JWT staleness test)

## 2. Paper Submission

- [ ] Navigate to submission form (must be logged in)
- [ ] Submit with all fields empty → validation errors shown (all at once, not one-by-one)
- [ ] Submit with title > 500 chars → rejected
- [ ] Submit with a `.txt` file renamed to `.pdf` → rejected (magic bytes check)
- [ ] Submit a real PDF with title, abstract, category, tags → success
- [ ] Paper appears in database with correct `YYYY-NNN` ID
- [ ] PDF file exists on disk at `uploads/papers/YYYY-NNN/paper.pdf`
- [ ] `metadata.yaml` exists at `../submissions/YYYY-NNN/metadata.yaml`
- [ ] Tags created correctly (lowercased, hyphenated)
- [ ] Submitter recorded as author (order = 1)
- [ ] Submit a second paper → ID increments (e.g. `2026-002`)
- [ ] Submit with optional LaTeX source → `.tex` file stored alongside PDF

## 3. Paper Browsing

- [ ] `/papers` shows published papers only (as regular user)
- [ ] Newly submitted paper does NOT appear (status = `submitted`, not `published`)
- [ ] As editor: paper appears with status badge
- [ ] Pagination works when > 20 papers exist
- [ ] Category filter works (research / expository)
- [ ] Paper cards show: ID, title, abstract snippet, authors, tags, category

## 4. Paper Detail View

- [ ] `/papers/YYYY-NNN` shows full paper for published paper
- [ ] `/papers/YYYY-NNN` returns 404 for unpublished paper (as regular user)
- [ ] `/papers/YYYY-NNN` shows unpublished paper for editors
- [ ] Authors displayed with avatars and author type
- [ ] Tags are clickable links to `/tags/[slug]`
- [ ] Download count and note count displayed
- [ ] Abstract rendered in full

## 5. PDF Download

- [ ] Click "Download PDF" → PDF streams in browser (Content-Type: application/pdf)
- [ ] Click "Download LaTeX" (if available) → .tex file downloads
- [ ] Download of unpublished paper blocked for non-editors
- [ ] Download logged in database for authenticated users
- [ ] Anonymous download works but is not logged
- [ ] Path traversal attempt (e.g. `../../etc/passwd`) → 400 error

## 6. Editorial Workflow

- [ ] Editor opens `/dashboard` → sees papers grouped by status
- [ ] Transition: submitted → under-review (button works)
- [ ] Assign reviewer by GitHub login → placeholder review created
- [ ] Assigning an author as reviewer → rejected
- [ ] Assigning someone who already has a review → rejected
- [ ] Transition: under-review → accepted → published
- [ ] On publish: `publishedAt` set, reviews become visible
- [ ] Paper now appears on public `/papers` page
- [ ] Transition: under-review → revision → under-review (back-edge works)
- [ ] Cannot transition published paper to any other status

## 7. Peer Review

- [ ] Assigned reviewer opens `/reviews/YYYY-NNN`
- [ ] Non-assigned user sees error or empty state
- [ ] Fill in all 5 scores (1–5 sliders/selectors)
- [ ] Fill in required text fields (summary, strengths, weaknesses)
- [ ] Submit → review saved in database
- [ ] Scores visible on paper detail page ONLY after paper accepted/published
- [ ] Before acceptance: review exists in DB but `visible = false`

## 8. Social Layer — Notes

- [ ] On published paper detail page, note input form visible (when logged in)
- [ ] Submit a note → appears on page immediately
- [ ] Reply to a note → threaded correctly (indented)
- [ ] Reply to a reply → nested threading works
- [ ] At depth 3+, reply button hidden (depth limit enforced)
- [ ] Note with empty content → rejected
- [ ] Note with > 10,000 chars → rejected
- [ ] Note on unpublished paper → rejected (for non-editors)

## 9. Social Layer — Favourites

- [ ] Click favourite button on paper → count increments
- [ ] Click again → count decrements (toggle)
- [ ] Favourite appears on user profile page
- [ ] Rapid double-click doesn't create duplicate (race condition handling)

## 10. Social Layer — Read Marking

- [ ] Download a paper, then click "Mark as read"
- [ ] Button becomes disabled after marking
- [ ] Paper appears in reading history on user profile
- [ ] Mark as read WITHOUT prior download → still works (creates download record)

## 11. Search

- [ ] `/search` page loads with query input
- [ ] Search for a word in a published paper's title → paper found
- [ ] Search for a word in abstract → paper found
- [ ] Results ranked (title match should rank higher than abstract match)
- [ ] Category filter works alongside search query
- [ ] Empty query → no results (no crash)
- [ ] SQL injection attempt (e.g. `'; DROP TABLE--`) → sanitized, no crash
- [ ] Search for unpublished paper → not found
- [ ] Pagination works for large result sets

## 12. Tags

- [ ] `/tags` shows tag cloud with sizes proportional to paper count
- [ ] Click a tag → `/tags/[slug]` shows papers with that tag
- [ ] Only published papers shown in tag view
- [ ] Tags on paper cards link correctly

## 13. User Profiles

- [ ] `/users/[login]` shows profile with avatar, name, author type, GitHub link
- [ ] Papers section shows authored papers
- [ ] Reviews section shows visible reviews only
- [ ] Reading history shows last 20 read papers
- [ ] Favourites section shows last 20
- [ ] "Similar Interests" shows users with overlapping reading patterns
- [ ] Jaccard percentage displayed correctly

## 14. Security

- [ ] CSRF: POST to `/api/auth/logout` from a different origin → 403
- [ ] Rate limiting: send 121 requests in 60s → 429 on the 121st
- [ ] Security headers present (check with browser dev tools):
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Content-Security-Policy` present
  - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] Unauthenticated POST to social actions → rejected
- [ ] Editor demoted in DB mid-session → editorial actions fail on next attempt

## 15. Edge Cases

- [ ] Two users submit papers simultaneously → both get unique IDs (no collision)
- [ ] Upload a 50 MB PDF → accepted
- [ ] Upload a 51 MB PDF → rejected
- [ ] Submit with exactly 20 tags → accepted
- [ ] Submit with 21 tags → rejected
- [ ] Very long abstract (10,000 chars) → accepted
- [ ] Abstract at 10,001 chars → rejected

---

## What This Doesn't Cover (Future)

- Performance under load
- Mobile responsiveness
- Accessibility (screen readers, keyboard navigation)
- Browser compatibility (Safari, Firefox, Chrome)
- Database migration correctness
- Backup and recovery
- Deployment to production environment

---

*This checklist should be worked through manually in a browser with the app running against a real PostgreSQL database. Every checkbox represents something that 240 passing unit tests cannot verify.*
