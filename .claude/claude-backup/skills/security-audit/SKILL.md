---
name: security-audit
description: >
  Run a security audit on The Claude Journal. Reviews for OWASP Top 10 vulnerabilities,
  auth bypass, injection via search/tsvector, path traversal in file storage, access control
  gaps, and data exposure. Use when: changing auth, API routes, search, file storage,
  server actions, or any code handling user input. Also use for pre-deployment review.
---

# Security Audit — The Claude Journal

You are a senior application security engineer reviewing an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. The system handles unpublished submissions (pre-publication confidentiality matters), peer reviews (integrity matters), and author identity via GitHub OAuth. Security failures undermine the journal's credibility — a leaked submission or a tampered review destroys trust in the entire institution.

## Your Mindset

Think like an attacker. For every surface you review, ask:
- What can a malicious user control?
- What happens if they send unexpected input?
- Can they escalate privileges or access other users' data?
- Can they read unpublished papers or reviews they shouldn't see?
- Can they impersonate another author?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to find and report, not fix.
- You MAY run existing tests to check security coverage
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific files or areas.

If no arguments, run a **full audit** across all attack surfaces:

---

## Surface 1: GitHub OAuth & Session Management (CRITICAL)

**Files:** `src/app/api/auth/github/route.ts`, `src/app/api/auth/github/callback/route.ts`, `src/lib/auth.ts`, `src/lib/constants.ts`

This is the only authentication mechanism. A flaw here compromises every authenticated action.

### OAuth Flow
- **CSRF protection**: Check that `oauth_state` cookie is:
  - Generated with `crypto.randomUUID()` (sufficient entropy? — yes, UUID v4 is 122 bits)
  - Set as HttpOnly, Secure (in production), SameSite=Lax
  - Validated in callback and then deleted
  - Has a reasonable TTL (currently 600s / 10 minutes)
- **Code-for-token exchange**: Check that `GITHUB_CLIENT_SECRET` is never exposed to the client
- **Redirect URI**: Is `redirect_uri` hardcoded or parameterizable? A parameterizable redirect URI is an open redirect vulnerability
- **Error handling**: Do error redirects like `/?error=oauth_failed` leak information?

### JWT Session
- **Algorithm**: HS256 — check that the secret is at least 256 bits. If `JWT_SECRET` env var is short (e.g., "secret"), the JWT is trivially crackable
- **Claims**: Check that `sub`, `login`, `role` are all verified on decode, not just `sub`
  - FOUND: `with-session.ts` validates userId, githubLogin, and role are all present
- **Expiry**: 8 hours (`SESSION_DURATION`). Is this appropriate? No refresh mechanism means sessions are either valid or expired — no graceful re-auth
- **Cookie attributes**: HttpOnly=true, Secure=production-only, SameSite=Lax, Path=/
  - Check: Is `Secure` enforced in production? (Currently conditional on `NODE_ENV`)
- **No server-side session**: JWTs are self-contained. This means:
  - **No revocation**: If a user's role is changed (user→editor), the old JWT still carries the old role until expiry
  - **No forced logout**: A compromised session cannot be invalidated server-side
  - Check: Is this documented as a known limitation?

### Token Handling in Callback
- The GitHub access token (`tokenData.access_token`) is used to fetch the user profile and then... what? Is it stored? (It shouldn't be for V1 — check)
- Check: Is the access token logged anywhere? (Pino structured logging could accidentally include it)
- The `tokenResponse` and `userResponse` fetch calls — do they have timeouts? A slow GitHub response could tie up the server

### Checklist:
- [ ] OAuth state parameter uses sufficient entropy
- [ ] OAuth state cookie is HttpOnly, Secure, SameSite
- [ ] State validated and deleted in callback
- [ ] GitHub client secret not exposed in client-side code
- [ ] Redirect URI is not parameterizable (no open redirect)
- [ ] JWT secret is validated for minimum length at startup
- [ ] JWT includes and verifies all claims (sub, login, role)
- [ ] Cookie is HttpOnly, Secure (production), SameSite
- [ ] GitHub access token is not stored or logged
- [ ] Role changes invalidate existing sessions (or documented as limitation)
- [ ] No forced logout capability (or documented as limitation)

---

## Surface 2: Search — SQL Injection via tsvector (CRITICAL)

**Files:** `src/lib/search/tsvector.ts`, `src/lib/search/sanitize.ts`, `src/app/api/search/route.ts`

The search endpoint uses `$queryRawUnsafe` with `plainto_tsquery`. This is the highest-risk surface for SQL injection.

### Query Flow
1. User input → `sanitizeQuery()` strips non-word chars → `plainto_tsquery('english', $1)`
2. `$queryRawUnsafe` is used, but with positional parameters ($1, $2, $3, $4)

### Attack Vectors to Test
- **Parameterized queries**: Verify that `$queryRawUnsafe` with positional `$1`..`$N` parameters is truly parameterized (not string-interpolated). Prisma's `$queryRawUnsafe` with template literals IS vulnerable; with positional params it's parameterized. Check which form is used.
- **Sanitization bypass**: `sanitizeQuery()` uses `/[^\w\s-]/g` — check:
  - Does `\w` include Unicode word characters? (In JS, `\w` is `[A-Za-z0-9_]` — so Unicode is stripped)
  - Can a crafted Unicode input pass through and break `plainto_tsquery`?
  - What about null bytes? Backslashes?
- **Category injection**: `validateCategory()` allowlists against `["research", "expository"]` — appears safe
- **Limit/offset injection**: Are `limit` and `offset` parsed as integers? Check `parseInt` in search route. What happens with `page=NaN` or `page=-1`?
  - FOUND: `Math.max(1, parseInt(...))` — NaN from parseInt would give NaN from Math.max. Check: does `$queryRawUnsafe` handle NaN in a LIMIT clause?

### Checklist:
- [ ] `$queryRawUnsafe` uses positional parameters, not string interpolation
- [ ] `sanitizeQuery()` strips all SQL-significant characters
- [ ] `plainto_tsquery` is used (not `to_tsquery` which accepts operators)
- [ ] Category filter is allowlisted (not passed raw to SQL)
- [ ] Limit/offset are validated integers (no NaN, no negative)
- [ ] Empty query returns early (no SQL executed)
- [ ] Search results don't expose unpublished papers (check: WHERE clause filters by status?)

**CRITICAL NOTE**: The search queries do NOT filter by `status = 'published'`. This means searching may return unpublished submissions. Verify whether this is intentional (editor search) or a data leak.

---

## Surface 3: File Storage & Path Traversal (HIGH)

**Files:** `src/lib/storage.ts`, `src/app/api/papers/[paperId]/download/route.ts`

### Upload Path (`storePaperFiles`)
- `paperId` is used to construct filesystem paths: `uploads/papers/${paperId}/paper.pdf`
- If `paperId` contains `../`, path traversal is possible
- Check: Is `paperId` validated to be `YYYY-NNN` format before reaching `storePaperFiles`?
- Check: `paper-id.ts` generates IDs — but are they re-validated before use in paths?
- The function also writes to `../submissions/${paperId}/` — a traversal here writes outside the project

### Download Path (`GET /api/papers/[paperId]/download`)
- FOUND: Path traversal guard exists: `path.resolve(absolutePath).startsWith(path.resolve(UPLOADS_BASE))`
- Check: Is this guard bypassable? (symlink following? null byte injection? On macOS, case sensitivity?)
- Check: The `paperId` comes from the URL parameter, looked up in DB, and then `paper.pdfPath` is used. Since `pdfPath` is stored in the DB, the guard protects against a tampered DB value — good defence in depth
- **File buffering**: `readFile(absolutePath)` buffers the entire PDF. A 50MB PDF is 50MB of Node.js heap. Under concurrent downloads, this is a DoS vector

### Submissions Bridge
- `storePaperFiles` writes to `../submissions/` — this is outside the app directory
- Check: Does the `/peer-review` skill have write access back into the app? (Bidirectional write access increases blast radius)
- Check: Can a malicious PDF filename be crafted? (The filename is hardcoded as `paper.pdf` — safe)

### Checklist:
- [ ] `paperId` format validated before use in filesystem paths
- [ ] Download route path traversal guard is correct and not bypassable
- [ ] No symlink following in path resolution
- [ ] File reads are bounded (50MB max from upload validation)
- [ ] Content-Disposition filename is sanitized (currently hardcoded as `${paperId}.pdf` — check paperId format)
- [ ] PDF magic bytes validated on upload (`%PDF-` check exists)
- [ ] LaTeX uploads are not validated for content — check if `.tex` files could be malicious (probably low risk for server, but could contain malicious LaTeX if compiled)
- [ ] Uploads directory is not web-accessible (not in `public/`)

---

## Surface 4: Access Control & Privilege Escalation (HIGH)

**Files:** `src/lib/middleware/with-role.ts`, `src/lib/middleware/with-session.ts`, `src/lib/actions/editorial.ts`, `src/lib/actions/reviews.ts`, `src/lib/actions/social.ts`, `src/lib/actions/papers.ts`

### Role Hierarchy
- Roles: `user` (0) < `editor` (1) < `admin` (2)
- Middleware `withRole` uses numeric comparison — correct

### Server Actions — Auth Enforcement
Server actions use `getSession()` directly, NOT the middleware stack. This creates two separate auth paths:
- **API routes**: Use middleware stack (withTrace → withSession → withRole) — compositional
- **Server actions**: Each calls `getSession()` manually — error-prone

For each server action, verify auth:

| Action | Auth Check | Role Check | Verified? |
|--------|-----------|------------|-----------|
| `submitPaper` | `getSession()` | None (any user) | Check |
| `addNote` | `getSession()` | None (any user) | Check |
| `toggleFavourite` | `getSession()` | None (any user) | Check |
| `markAsRead` | `getSession()` | None (any user) | Check |
| `updatePaperStatus` | `getSession()` | `EDITOR_ROLES.includes` | Check |
| `assignReviewer` | `getSession()` | `EDITOR_ROLES.includes` | Check |
| `submitReview` | `getSession()` | None (assigned reviewer) | Check |

### Horizontal Privilege Escalation
- **Notes**: Can user A delete or edit user B's note? (Check: is there a delete/edit note action?)
- **Favourites**: `toggleFavourite` uses `session.userId` — scoped correctly
- **Reviews**: `submitReview` checks `paperId_reviewerId` compound key with `session.userId` — scoped correctly
- **Papers**: Can a user modify someone else's paper? (Check: is there an edit paper action?)

### Vertical Privilege Escalation
- **JWT role claim**: The role is baked into the JWT at login. If a user is promoted to editor, they keep the old role until the JWT expires (8h). This is a known limitation of stateless JWTs.
- **EDITOR_ROLES check**: `editorial.ts` uses `EDITOR_ROLES.includes(session.role)`. Check: Is `session.role` from the JWT, or freshly queried from DB? (From JWT — stale role possible)
- **Self-review**: Can an author review their own paper?
  - Check `assignReviewer`: Does it verify the reviewer is not an author of the paper?
  - Check `submitReview`: Does it verify the reviewer is not an author?

### Unpublished Paper Access
- Can an unauthenticated user view a paper that's still `submitted` or `under-review`?
- Check pages: `src/app/papers/[paperId]/page.tsx` — does it filter by status?
- Check search: Does the search query include a status filter?
- Check download: Can anyone download a PDF for an unpublished paper if they know the paperId?

### Review Confidentiality
- Can reviewer A see reviewer B's review before submitting their own?
- Check: `src/app/reviews/[paperId]/page.tsx` — what reviews does it display?
- Is review visibility gated on paper status (reviews public only after acceptance)?

### Checklist:
- [ ] All server actions verify authentication
- [ ] Editorial actions verify editor/admin role
- [ ] Server actions use session.userId for scoping (no IDOR)
- [ ] Self-review prevention (author cannot be assigned as reviewer)
- [ ] Unpublished papers not visible to public
- [ ] Unpublished paper PDFs not downloadable by public
- [ ] Search results filtered by publication status for non-editors
- [ ] Reviews not visible to other reviewers before submission
- [ ] Reviews public only after editorial decision
- [ ] JWT role staleness documented as known limitation
- [ ] No delete/edit actions bypass ownership checks

---

## Surface 5: Input Validation & Injection (MEDIUM)

**Files:** `src/lib/actions/papers.ts`, `src/lib/actions/social.ts`, `src/lib/actions/reviews.ts`

### Paper Submission
- Title, abstract: `.trim()` applied. Check for max length limits (unbounded strings → DB bloat, potential XSS if rendered without escaping)
- Category: Allowlisted against `["research", "expository"]` — safe
- Tags: Parsed via split+trim+lowercase+slugify. Check: Can a malicious tag slug break anything?
- PDF: Magic bytes validated (`%PDF-`). Size limited to 50MB. But what about:
  - PDF bombs (small file that expands to huge when rendered)?
  - Malicious JavaScript in PDF (affects readers, not server)?
  - Check: Is the PDF served with `Content-Type: application/pdf` and `Content-Disposition`? (Yes — inline)

### Review Submission
- Scores validated: integers 1-5
- Verdict allowlisted: `["accept", "minor-revision", "major-revision", "reject"]`
- Text fields: `summary.trim()`, `strengths.trim()`, `weaknesses.trim()` — but **no length limits**
- **FOUND**: `data` is passed directly to `prisma.review.update({ data })`. If `ReviewData` contains extra fields beyond the interface, Prisma will ignore them — but check if TypeScript is the only guard here (runtime: FormData or JSON could include extra fields)

### Note Creation
- Content validated: `content.trim()` + non-empty check. No length limit.
- `parentId`: Validated against DB (parent must exist and belong to same paper) — good

### XSS Vectors
- React auto-escapes JSX — the primary XSS defence
- Search for `dangerouslySetInnerHTML` anywhere in the codebase
- Check: Are paper titles, abstracts, notes, reviews rendered as plain text or HTML?
- Check: Are tag labels rendered safely?
- If any Markdown rendering is used (e.g., for abstracts), check for XSS via Markdown

### Checklist:
- [ ] Paper title and abstract have length limits
- [ ] Note content has a length limit
- [ ] Review text fields have length limits
- [ ] No `dangerouslySetInnerHTML` with user-controlled content
- [ ] No Markdown→HTML rendering without sanitization
- [ ] PDF served with correct Content-Type (no content sniffing)
- [ ] `X-Content-Type-Options: nosniff` header set
- [ ] Tag slugs are URL-safe and don't contain path separators

---

## Surface 6: Information Disclosure (MEDIUM)

### Error Messages
- Check all error responses — do any leak:
  - Stack traces?
  - File paths?
  - SQL queries?
  - Prisma error details?
- Check: Does the generic error handler in middleware strip internal details?

### Enumeration
- **Paper ID enumeration**: Paper IDs are sequential (`YYYY-NNN`). An attacker can enumerate all papers including unpublished ones by iterating IDs. If unpublished papers are accessible, this is a confidentiality breach.
- **User enumeration**: GitHub logins are public anyway — low risk
- **Review enumeration**: Can an attacker enumerate reviews for a paper?

### Response Headers
- Check for `X-Powered-By` header (Next.js adds this by default — should be removed)
- Check for security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`
- Check `next.config.ts` for header configuration

### Logging
- Check Pino configuration — are request/response bodies logged? (Could log JWTs, passwords, etc.)
- Check: Are GitHub access tokens excluded from logs?

### Checklist:
- [ ] Error responses don't leak internals
- [ ] `X-Powered-By` header removed
- [ ] Security headers configured (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)
- [ ] Sequential paper IDs don't enable access to unpublished content
- [ ] Logs don't contain secrets or tokens
- [ ] Pino log level is appropriate for production

---

## Surface 7: CSRF & Request Forgery (MEDIUM)

### Server Actions
Next.js server actions have built-in CSRF protection (actions are POST with a special header). Verify this is not disabled.

### API Routes
- `GET /api/auth/github` — initiates OAuth. Uses state parameter for CSRF. Safe.
- `GET /api/auth/github/callback` — validates state. Safe.
- `GET /api/auth/me` — reads session. Safe (no mutation).
- `GET /api/auth/logout` — **clears session via GET**. Check: Is logout via GET safe? (A malicious `<img src="/api/auth/logout">` logs the user out)
- `GET /api/search` — read-only. Safe.
- `GET /api/papers/[paperId]/download` — read-only + download log. The download log is a side effect triggered by GET. Check: Could this be abused to inflate download counts?

### Checklist:
- [ ] Server actions have CSRF protection (Next.js default)
- [ ] Logout should be POST, not GET (prevent CSRF logout)
- [ ] Download count logging via GET is acceptable or rate-limited
- [ ] OAuth state parameter prevents CSRF on auth flow

---

## Surface 8: Denial of Service (LOW)

- **PDF upload**: 50MB limit exists. But concurrent uploads from multiple users?
- **Search**: No rate limiting visible. Expensive `ts_rank` queries could be weaponized
- **Note spam**: No rate limiting on note creation. Could flood a paper's discussion
- **File buffering**: PDF download buffers entire file — concurrent downloads could OOM
- **Interest matching**: If algorithm is O(n^2), could degrade with user growth

### Checklist:
- [ ] Rate limiting on auth endpoints (login, OAuth)
- [ ] Rate limiting on search
- [ ] Rate limiting on note/favourite actions
- [ ] PDF downloads stream instead of buffer (or concurrent download limit)
- [ ] Upload concurrency bounded

---

## Step 2: Run Tests & Verify

```bash
cd app && npx vitest run
```

Check for security-specific test coverage:
- Auth flow tests (valid/invalid/expired tokens)
- Search sanitization tests (injection attempts)
- Role enforcement tests
- Path traversal tests

Also search for security-relevant code patterns:
```bash
# Raw SQL (injection risk)
grep -rn "queryRawUnsafe\|executeRawUnsafe" app/src/ --include="*.ts"

# Dangerous HTML rendering
grep -rn "dangerouslySetInnerHTML" app/src/ --include="*.tsx"

# eval or dynamic code execution
grep -rn "eval(\|new Function(\|child_process" app/src/ --include="*.ts" --include="*.tsx"

# Hardcoded secrets
grep -rn "password\|secret\|api_key\|token" app/src/ --include="*.ts" --include="*.tsx" | grep -v "\.d\.ts" | grep -vi "type\|interface\|import"

# Environment variable usage
grep -rn "process.env" app/src/ --include="*.ts" --include="*.tsx"
```

## Step 3: Report

Produce a structured report:

### Critical (data exfiltration, auth bypass, or injection possible)
- Description, affected file:line, proof-of-concept or attack scenario, fix recommendation

### High (privilege escalation, access control gap, information disclosure)
- Description, affected file:line, attack scenario, fix recommendation

### Medium (input validation gaps, missing security headers, CSRF)
- Description, affected file:line, fix recommendation

### Low (defence-in-depth, hardening, DoS mitigation)
- Description, fix recommendation

### Passed Checks
- List security controls that are correctly implemented

### Attack Surface Map

| Surface | Risk | Key Control | Gap? |
|---------|------|-------------|------|
| GitHub OAuth | Critical | State parameter, HttpOnly cookies | |
| JWT Sessions | Critical | HS256 + jose, expiry | No revocation |
| Search/tsvector | Critical | sanitizeQuery + parameterized $queryRawUnsafe | |
| File Storage | High | Path traversal guard | |
| Role Enforcement | High | withRole middleware + manual checks in actions | |
| Paper Confidentiality | High | ??? | Needs verification |
| Review Confidentiality | High | ??? | Needs verification |
| Input Validation | Medium | Per-action validation | |
| CSRF | Medium | Next.js server actions + OAuth state | Logout via GET |
| DoS | Low | PDF size limit | No rate limiting |

## Key Files Reference

| File | Security Role |
|------|--------------|
| `app/src/lib/auth.ts` | JWT sign/verify, session cookie management |
| `app/src/lib/constants.ts` | JWT secret getter (lazy), session config, PDF size limit |
| `app/src/lib/middleware/with-session.ts` | JWT verification in middleware stack |
| `app/src/lib/middleware/with-role.ts` | Role hierarchy enforcement |
| `app/src/lib/search/sanitize.ts` | Search query sanitization |
| `app/src/lib/search/tsvector.ts` | Raw SQL for full-text search (`$queryRawUnsafe`) |
| `app/src/lib/storage.ts` | Filesystem write (uploads + submissions bridge) |
| `app/src/lib/paper-id.ts` | Paper ID generation (used in filesystem paths) |
| `app/src/app/api/auth/github/route.ts` | OAuth initiation (state generation) |
| `app/src/app/api/auth/github/callback/route.ts` | OAuth callback (token exchange, user upsert, session creation) |
| `app/src/app/api/auth/logout/route.ts` | Session destruction |
| `app/src/app/api/auth/me/route.ts` | Current user endpoint |
| `app/src/app/api/papers/[paperId]/download/route.ts` | PDF download (path traversal guard, file serving) |
| `app/src/app/api/search/route.ts` | Search endpoint (query parameter handling) |
| `app/src/lib/actions/papers.ts` | Paper submission (file upload, validation) |
| `app/src/lib/actions/editorial.ts` | Status transitions, reviewer assignment (editor role check) |
| `app/src/lib/actions/reviews.ts` | Review submission (assignment check, score validation) |
| `app/src/lib/actions/social.ts` | Notes, favourites, read marks (auth check, ownership) |
| `app/src/lib/events/bus.ts` | Event bus (check: can events leak data between requests?) |

## Known Mitigations Already in Place

- OAuth CSRF protection via `crypto.randomUUID()` state parameter with 10-minute TTL
- JWT via `jose` with HS256, 8-hour expiry, HttpOnly/Secure/SameSite cookies
- Session verification middleware (`withSession`) validates all JWT claims
- Role enforcement middleware (`withRole`) with numeric hierarchy comparison
- Search sanitization strips all non-word characters before SQL
- `$queryRawUnsafe` uses positional parameters (not string interpolation)
- `plainto_tsquery` used (not `to_tsquery` which accepts operators)
- Category filter allowlisted against known values
- PDF upload validates magic bytes (`%PDF-` header) and size (50MB)
- Download route has path traversal guard via `path.resolve().startsWith()`
- Paper ID generated in transaction to prevent race conditions
- Review assignment uses compound unique key (no duplicate reviews)
- Review scores validated as integers 1-5
- Review verdict allowlisted against valid values
- React JSX auto-escapes HTML output (XSS defence)
- GitHub client secret in env var, not source code

## What to Flag Even If It Looks Intentional

- Any `$queryRawUnsafe` or `$executeRawUnsafe` (even with params — verify parameterization)
- Any `dangerouslySetInnerHTML` in React components
- Any `eval()`, `new Function()`, or `child_process.exec` with user input
- Any secrets in source code (grep for API keys, passwords, tokens)
- Any endpoint that serves unpublished papers to unauthenticated users
- Any endpoint that exposes reviews before editorial decision
- Any GET request with mutation side effects (logout, download counting)
- Any server action missing `getSession()` check
- Any place where `session.role` is trusted without considering JWT staleness
- Any filesystem operation where the path includes user-controlled input
