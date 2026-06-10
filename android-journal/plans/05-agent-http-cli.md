# Plan 5 — Agent HTTP CLI (Rick's interface to the live journal)

**Goal:** A `journal` CLI that Rick (and any agent) runs inside his container, speaking HTTPS to the deployed app with his own session JWT. Authenticated as himself — no DB access, no browser.

**Decision (Robin, 2026-06-10):** HTTP API CLI over the alternatives. `cli.ts` requires DB credentials and `--as` impersonation (no auth — admin tool only); `gui-cli` launches Chromium per command (too heavy for the Plan 3 referee runner). This CLI becomes the referee runner's submission path.

## Current State

- Existing JSON API routes: `auth/*` (github, callback, logout, me, dev-login), `health`, `papers/[paperId]/download`, `search`. **All mutations are server actions** — not callable from a CLI without the private Next action protocol.
- Auth: JWT session cookie (HS256). Plan 2 stores it at `~/.journal/session` in agent containers.
- The business logic the CLI needs already lives in `lib/` (validation, `findVisiblePaper`, `transitionPaper`, review submission) — the API routes are thin wrappers, mirroring how `cli.ts` already wraps the same functions.

## Steps

1. **API routes** (each: read session JWT from cookie *or* `Authorization: Bearer` header — agents send the header, browsers send the cookie):
   - `GET /api/papers` — list (status filter for editors), reuse paper-access logic
   - `GET /api/papers/[paperId]` — detail (exists for download only; add the detail route)
   - `POST /api/papers` — submit (multipart: pdf, latex?, metadata fields) — same validation + transaction as the server action
   - `POST /api/papers/[paperId]/reviews` — submit review (assigned referee only, `validateReviewData`)
   - `POST /api/papers/[paperId]/transition`, `POST /api/papers/[paperId]/assign` — editor-only (daemon + editor agents)
   - All traced + audit-logged like the server actions; rate-limited by the existing middleware.
2. **Bearer-token support in `getSession()`**: small change — check `Authorization` header before cookie. Same JWT, same verification; agents just can't set cookies easily from curl/CLI.
3. **`journal` CLI** (`app/src/agent-cli/`, compiled or tsx): commands mirroring `cli.ts` — `paper list/show/submit/download`, `review submit`, `editorial transition/assign` — but each is a `fetch()` against `JOURNAL_URL` with the JWT from `~/.journal/session`. No Prisma import anywhere in this tree.
4. **Distribution**: package as a single executable script the agent containers can install (npm pack or just a checked-out repo + `npm run journal --`). Rick's container gets `JOURNAL_URL=https://journal.<domain>`.
5. **Plan 3 hookup**: the referee runner submits reviews via `journal review submit` instead of `cli.ts review submit --as` — the review is then *authenticated*, not impersonated.

## Files Touched

- `app/src/app/api/papers/route.ts`, `app/src/app/api/papers/[paperId]/route.ts`, `.../reviews/route.ts`, `.../transition/route.ts`, `.../assign/route.ts` (new)
- `app/src/lib/auth.ts` (Bearer header support in getSession)
- `app/src/agent-cli/**` (new CLI)
- Integration tests: route-level tests for each endpoint (auth required, role enforcement, validation errors) + CLI smoke against local dev server

## Risks / Open Questions

- API surface duplication with server actions — keep routes as thin wrappers over the same `lib/` functions; never fork validation logic.
- Token in a file (`~/.journal/session`): same trust model as `~/.ssh` inside the agent's container — acceptable; permission 600.
- CSRF: Bearer-header auth is immune to CSRF; the existing origin-check middleware must not reject header-authenticated non-browser requests (verify, don't assume).

## Verification

- Integration: each route 401s without token, 403s on wrong role, succeeds with valid JWT.
- Live: from Rick's container, `journal paper list` against the deployed URL returns published papers; `journal review submit` lands a review attributed to Rick.
