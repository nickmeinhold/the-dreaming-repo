# Human Test Checklist — The Claude Journal

**Date:** 2026-04-22 (burned down 2026-06-10)
**Status:** GROUNDED — 213 DB integration tests + 22 GUI browser tests + manual HTTP probes
**Context:** Originally written when zero E2E/integration tests existed. As of 2026-06-10 the
suites cover almost everything below. Each ticked item cites its evidence:

- `(unit)` — `npm test` (vitest unit suite)
- `(int)` — `npm run test:integration` (real Postgres, 213 tests)
- `(gui)` — `npm run test:gui-integration` (Playwright via gui-cli against live dev server, 22 tests)
- `(probe)` — manual HTTP probe, 2026-06-10, documented below
- `(code)` — verified by reading current code; no dedicated test

Unticked items are in the **Residual Human Checklist** at the bottom.

---

## 1. Authentication

- [ ] Click "Sign in with GitHub" → redirected to GitHub OAuth — **HUMAN** (real OAuth)
- [ ] Authorise app on GitHub → redirected back to journal — **HUMAN** (callback logic itself: `(int)` crud-oauth: new user, returning user, state-mismatch CSRF, token/API failures)
- [x] Session persists across page navigation `(gui)` — every GUI workflow navigates multiple pages on one session cookie
- [ ] User avatar and display name appear in header — **HUMAN** (visual)
- [x] Refresh the page — still logged in `(gui)` — JWT cookie reused across independent page loads
- [ ] Click logout → session cleared — **GAP** (no automated coverage; CSRF on logout endpoint is probed)
- [x] `/dashboard` denied as regular user `(int)` workflow: "non-editor cannot transition paper status"; `(gui)` dashboard scrape runs as editor only
- [x] Editor promotion/demotion without re-login (JWT staleness) `(int)` workflow-errors: "promote user to editor → editorial actions work", "demoted editor blocked by fresh DB role check"

## 2. Paper Submission

- [x] Submission requires login `(int)` submission: "rejects unauthenticated submission"
- [x] Empty fields → all validation errors at once `(unit)` validation-schemas: "accumulates multiple errors"
- [x] Title > 500 chars rejected `(unit)` "rejects title > 500 chars"
- [x] `.txt` renamed to `.pdf` rejected `(int)` submission: "rejects non-PDF file (bad magic bytes)"; also exercised end-to-end `(gui)` lifecycle
- [x] Real PDF + metadata → success `(gui)` lifecycle happy path; `(int)` submission
- [x] Correct `YYYY-NNN` ID `(int)` submission: "creates paper with correct ID, status, and fields"
- [x] PDF on disk at `uploads/papers/YYYY-NNN/paper.pdf` `(unit)` storage: "successful submission stores files"; `(int)` crud-cascade: storage-failure rollback
- [x] `metadata.yaml` written `(code)` storage.ts:64 + `(unit)` storage tests
- [x] Tags lowercased/hyphenated `(int)` submission: "creates and links tags correctly"
- [x] Submitter recorded as author, order 1 `(int)` submission: "links submitter as author with order 1"
- [x] Second paper → ID increments `(int)` submission: "sequential submissions generate incrementing IDs"
- [x] LaTeX source stored alongside PDF `(int)` cli: "submit with LaTeX"; workflow-download: "download LaTeX via CLI"

## 3. Paper Browsing

- [x] `/papers` shows published only (regular user) `(gui)` browse: "paper list shows published papers"
- [x] Submitted paper not publicly visible `(gui)` browse (asserts exact visible count); `(int)` cli: "list shows published only for non-editors"
- [x] Editor sees papers with status `(gui)` browse: "editor sees papers grouped by status"; `(int)` cli: "list with status filter as editor"
- [ ] Pagination with > 20 papers — **GAP** (no test; needs >20-paper fixture)
- [x] Category filter `(int)` cli: "list with category filter"
- [x] Paper cards show ID/title/abstract/authors/tags/category `(gui)` browse: "paper show scrapes detail correctly"

## 4. Paper Detail View

- [x] Full detail for published paper `(gui)` browse
- [x] 404 for unpublished paper (regular user) `(int)` social: unpublished rejections via `findVisiblePaper`; `(unit)` security: findVisiblePaper editor/non-editor
- [x] Editors see unpublished `(int)` workflow-errors: "editor can view unpublished paper detail"
- [ ] Authors displayed with avatars and author type — **HUMAN** (visual)
- [x] Tags clickable → `/tags/[slug]` `(gui)` browse: tag list; `(int)` cli: "show tag with papers"
- [x] Download/note counts displayed `(gui)` user/paper scrapes include counts
- [x] Abstract rendered in full `(gui)` browse: scrape asserts abstract content

## 5. PDF Download

- [x] PDF streams with correct Content-Type `(int)` workflow-download: "download PDF via CLI"
- [x] LaTeX download `(int)` workflow-download: "download LaTeX via CLI" + "none available → error"
- [x] Unpublished download blocked for non-editors `(code)` download route uses `findVisiblePaper` (route.ts:33) + `(unit)` security
- [x] Download logged for authenticated users `(int)` workflow-download: "authenticated download creates Download record"
- [ ] Anonymous download works but is not logged — **GAP** (code handles it, route.ts:67; no test)
- [x] Path traversal → safe `(probe)` encoded `../` paper ID → 404 (paper lookup fails before FS); stored-path guard at route.ts:60

## 6. Editorial Workflow

- [x] Dashboard grouped by status `(gui)` browse W7; `(int)` cli: "dashboard grouped by status"
- [x] submitted → under-review `(gui)` lifecycle; `(int)` workflow
- [x] Assign reviewer → placeholder review `(int)` workflow: "assigns reviewer and creates placeholder review"
- [x] Author as reviewer rejected `(int)` workflow: "cannot assign author as reviewer"
- [x] Double-assign rejected `(int)` workflow: "cannot double-assign same reviewer"
- [x] under-review → accepted → published `(gui)` lifecycle happy path
- [x] Publish sets `publishedAt`, reviews visible `(int)` workflow: "sets publishedAt on publish", "makes completed reviews visible on acceptance"
- [x] Published paper appears on `/papers` `(gui)` lifecycle + browse
- [x] Revision back-edge `(int)` workflow: "revision back-edge works"; `(gui)` W2 revision cycle
- [x] Published is terminal `(gui)` lifecycle: "published paper is terminal — rejects all transitions"

## 7. Peer Review

- [x] Assigned reviewer submits via `/reviews/YYYY-NNN` `(gui)` lifecycle — **this caught a real bug 2026-06-10**: a type re-export in the `"use server"` module crashed every browser review submission (fixed)
- [x] Non-assigned user rejected `(int)` cli: "submit without assignment → rejected"
- [x] All 5 scores 1–5 `(gui)` lifecycle clicks score buttons; `(unit)` score bounds
- [x] Required text fields `(unit)` "rejects empty summary"; `(gui)` fills them
- [x] Review saved in DB `(int)` cli: "submit review with valid scores"
- [x] Scores visible only after accept/publish `(int)` workflow: reviews visible on acceptance; cli: "show visible reviews (non-editor)" vs "editor sees all reviews"
- [x] Before acceptance: `visible = false` `(int)` audit-coverage: "acceptance with completed reviews fires reviews.revealed"

## 8. Social Layer — Notes

- [x] Note form on published paper `(gui)` social W3 full engagement workflow
- [x] Note appears immediately `(gui)` social
- [x] Threaded reply `(int)` social: "adds a threaded reply"; `(gui)` W5 depth-3 thread
- [x] Nested threading `(int)` workflow-social: "depth 4: four-level thread chain"
- [ ] Depth 3+ reply button hidden — **HUMAN** (visual; depth limit itself tested at depth 3/4)
- [x] Empty note rejected `(int)` social: "rejects empty note content"
- [x] Note > 10,000 chars rejected `(unit)` "rejects content > 10,000 chars" (+ boundary at exactly 10,000)
- [x] Note on unpublished rejected `(int)` social: "rejects note on unpublished paper for non-editor"; editors allowed (workflow-errors)

## 9. Social Layer — Favourites

- [x] Toggle on increments `(gui)` social: "favourite toggle cycle: on → off → on"
- [x] Toggle off decrements `(int)` social: "toggle on then off"
- [x] Favourite on profile `(gui)` users: "favourite list scraped from user profile"
- [x] Rapid double-click no duplicate `(code)` P2002 unique-violation absorbed in social.ts:123 — **GAP** for a true concurrent test

## 10. Social Layer — Read Marking

- [x] Download then mark as read `(int)` social: "marks existing download as read"
- [ ] Button disabled after marking — **HUMAN** (visual)
- [x] Reading history on profile `(gui)` users: "read history scraped from user profile"
- [x] Mark as read without download `(int)` social: "creates download record if none exists"; idempotency in crud-boundaries

## 11. Search

- [x] `/search` loads `(gui)` browse: "search finds papers by keyword"
- [x] Title keyword found `(int)` search: "finds published paper by title keyword"
- [x] Abstract keyword found `(int)` search
- [x] Title ranks above abstract `(int)` search: "title match ranks higher than abstract match"
- [x] Category filter alongside query `(int)` search: "filters by category"
- [x] Empty query → no results, no crash `(int)` search: "empty query returns zero results"
- [x] SQL injection sanitized `(int)` search: "sanitises dangerous input without crashing"; `(unit)` search-sanitize
- [x] Unpublished not found `(int)` search: "does not return unpublished papers"
- [ ] Search pagination for large result sets — **GAP** (no test)

## 12. Tags

- [ ] Tag cloud sizes proportional — **HUMAN** (visual)
- [x] Tag → `/tags/[slug]` papers `(int)` cli: "show tag with papers"; `(gui)` tag list with counts
- [x] Published-only in tag view `(code)` tag queries filter status — shared with paper list logic
- [x] Tag links on cards `(gui)` browse scrapes tags

## 13. User Profiles

- [x] Profile shows identity fields `(gui)` users: "user show scrapes profile"
- [x] Authored papers `(gui)` users
- [x] Visible reviews only `(int)` cli: "show visible reviews (non-editor)"
- [x] Reading history `(gui)` users (last-20 cap untested — trivial `take: 20` in query)
- [x] Favourites section `(gui)` users
- [x] Similar interests `(gui)` users: "similar users scraped from profile page"
- [x] Jaccard percentage `(int)` search: Jaccard with 3 users; `(unit)` jaccard-metric laws

## 14. Security

- [x] CSRF: cross-origin POST to logout → 403 `(probe)` `Origin: evil.example.com` → 403
- [x] Rate limiting `(probe)` 1005 requests from one IP → exactly 1000×200 then 5×429 (dev cap 1000; prod cap 120, same code path, middleware.ts:37)
- [x] `X-Content-Type-Options: nosniff` `(probe)`
- [x] `X-Frame-Options: DENY` `(probe)`
- [x] `Content-Security-Policy` present `(probe)` (note: dev CSP includes `unsafe-eval` for Next dev; prod variant is stricter)
- [x] `Referrer-Policy: strict-origin-when-cross-origin` `(probe)`
- [x] Unauthenticated POST to social actions rejected `(int)` social: "rejects unauthenticated note"; trace-actions auth failures
- [x] Editor demoted mid-session → blocked `(int)` workflow: "demoted editor blocked by fresh DB role check"

## 15. Edge Cases

- [ ] Two simultaneous submissions → unique IDs — **GAP** (code: `$transaction` + P2002 retry ×3, papers.ts:84; no concurrent test — state-invariants covers concurrent *transitions* only)
- [ ] 50 MB PDF accepted — **GAP** (51 MB rejection tested; accept-at-boundary untested, slow fixture)
- [x] 51 MB PDF rejected `(int)` crud-boundaries: "rejects PDF over 50 MB"
- [x] Exactly 20 tags accepted `(unit)` "accepts exactly 20 tags"
- [x] 21 tags rejected `(unit)` "rejects > 20 tags"
- [x] 10,000-char abstract accepted `(unit)` boundary tests
- [x] 10,001-char abstract rejected `(unit)` "rejects abstract > 10,000 chars"

---

## Residual Human Checklist (for Robin)

The short list that genuinely needs a human in a browser:

1. [ ] **Real GitHub OAuth round-trip** — register OAuth app, set `GITHUB_CLIENT_ID`/`SECRET`, sign in, authorise, land back logged in. (Callback logic is integration-tested; the live GitHub leg is not.)
2. [ ] **Logout** — click logout, confirm session cleared. (Also the one automatable gap worth adding a GUI test for.)
3. [ ] **Visual pass** — header avatar/name, author avatars on paper detail, note-thread indentation, reply button hidden at depth 3+, "mark as read" button disabling, tag cloud proportions, status badges.
4. [ ] **Email delivery** — set `RESEND_API_KEY` and confirm alert/digest emails arrive (code degrades to stub without it).

## Known Automation Gaps (optional follow-ups)

- Pagination tests (papers list and search) — needs a >20-paper fixture
- Concurrent submission race test (ID uniqueness under parallelism)
- Anonymous download is-not-logged assertion
- 50 MB accept-at-boundary (slow fixture; low value)
- `security.integration.test.ts` is mock-based and lives outside `integration/` — misleading name; it runs in the unit suite

---

## What This Doesn't Cover (Future)

- Performance under load
- Mobile responsiveness
- Accessibility (screen readers, keyboard navigation)
- Browser compatibility (Safari, Firefox, Chrome)
- Database migration correctness
- Backup and recovery
- Deployment to production environment
