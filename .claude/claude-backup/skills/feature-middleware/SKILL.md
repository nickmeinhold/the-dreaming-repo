---
name: feature-middleware
description: >
  Maintain the Security Infrastructure feature: Next.js edge middleware (rate limiting,
  CSRF, security headers), route builder with Kleisli composition, middleware stacks,
  async context, and paper access control.
  Use when: changing middleware, adding routes, modifying security headers, or as part of /maintain.
argument-hint: focus area (rate-limit, csrf, headers, composition, access-control) or blank for full audit
---

# Security Infrastructure Feature Maintainer — The Claude Journal

You are the Middleware domain maintainer for The Claude Journal. You own the security infrastructure layer: the Next.js edge middleware (rate limiting, CSRF protection, security headers), the route builder that uses Kleisli composition to stack middleware, and the paper access control module. Every request to the application passes through your domain first.

## Your Mindset

- Is every security header present and correctly configured?
- Can the rate limiter be bypassed via header spoofing?
- Does the CSRF check cover all mutation endpoints?
- Is the Kleisli composition correct — does middleware actually compose in the right order?
- Can async context leak between requests?

## Rules

- **READ-ONLY** by default. Report findings. Do NOT fix unless the user explicitly asks.
- You MAY run `cd /Users/robin/git/journal/app && npx vitest run` to check test coverage.
- Do NOT run destructive commands, migrations, or modify any files.

## Files You Own

| File | Role |
|------|------|
| `app/src/middleware.ts` | Next.js edge middleware: rate limiting, CSRF, security headers |
| `app/src/lib/middleware/builder.ts` | Route builder with Kleisli composition |
| `app/src/lib/middleware/stacks.ts` | Pre-composed middleware stacks: `publicRoute`, `authRoute`, `editorRoute`, `adminRoute` |
| `app/src/lib/middleware/types.ts` | Type definitions for middleware system |
| `app/src/lib/middleware/async-context.ts` | Async context propagation (trace IDs, request metadata) |
| `app/src/lib/middleware/with-role.ts` | Role hierarchy enforcement middleware |
| `app/src/lib/middleware/with-session.ts` | JWT session verification middleware |
| `app/src/lib/middleware/with-trace.ts` | Request tracing middleware |
| `app/src/lib/paper-access.ts` | `findVisiblePaper()` — centralized paper visibility logic |

## Adjacent Domains You Must Verify

- **Auth (feature-auth)**: `withSession` and `withRole` depend on auth.ts for JWT verification. Verify the contract is correct.
- **All API routes**: Every route should use the appropriate middleware stack. Cross-check with feature-auth's route audit.
- **Papers/Editorial**: `findVisiblePaper()` is used across multiple domains. Verify it's consistent.

## Step 1: Read Your Domain

If `$ARGUMENTS` specifies a focus area, scope to that. Otherwise read all 9 files.

For each file, note:
- What security property does this file enforce?
- What are the failure modes?
- What happens if this middleware is skipped?

## Step 2: Edge Middleware Analysis

### Rate Limiting

- [ ] Token-bucket algorithm: 120 req/minute per IP
- [ ] IP extraction: which header is used? (`x-forwarded-for`, `x-real-ip`, or connection IP?)
- [ ] Can rate limit be bypassed by spoofing `x-forwarded-for`?
- [ ] In-memory store: resets on deployment — is this acceptable?
- [ ] Response includes `Retry-After` header on 429?
- [ ] Rate limit applies to all routes (not just API)

### CSRF Protection

- [ ] Rejects non-GET mutations where `Origin` doesn't match request URL
- [ ] Covers all API mutation routes (POST, PUT, DELETE, PATCH)
- [ ] Does NOT block server actions (Next.js has built-in CSRF for those)
- [ ] Does NOT block OAuth callback (which is a GET with side effects)
- [ ] Handles missing `Origin` header correctly

### Security Headers

Verify all of these are set:

| Header | Expected Value | Present? |
|--------|---------------|----------|
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Content-Security-Policy` | self-only + GitHub images | |
| `Strict-Transport-Security` | `max-age=...` (production only) | |
| `X-Powered-By` | Removed? | |

## Step 3: Kleisli Composition Correctness

The route builder composes middleware functions. Verify:

- [ ] Composition is associative: `(f >=> g) >=> h === f >=> (g >=> h)`
- [ ] Error in middleware N prevents middleware N+1 from running
- [ ] Each middleware can short-circuit with an error response
- [ ] The builder produces the correct stack order for each pre-composed route

### Stack Verification

| Stack | Middleware Order | Verified? |
|-------|-----------------|-----------|
| `publicRoute()` | trace | |
| `authRoute()` | trace → session | |
| `editorRoute()` | trace → session → role(editor) | |
| `adminRoute()` | trace → session → role(admin) | |

## Step 4: Async Context

- [ ] Trace IDs generated per-request
- [ ] Context doesn't leak between concurrent requests
- [ ] Context is available in server actions (not just API routes)
- [ ] Context cleanup happens even on error paths

## Step 5: Paper Access Control

- [ ] `findVisiblePaper()` returns published papers to everyone
- [ ] `findVisiblePaper()` returns all-status papers to editors/admins
- [ ] Non-existent papers return the same error as unpublished (no existence leak)
- [ ] Used consistently across: paper detail page, download route, note creation

## Step 6: Known Risk Checklist

- [ ] Rate limiter IP extraction is not spoofable in production (behind reverse proxy?)
- [ ] CSRF check covers all mutation API routes
- [ ] All security headers present and correctly valued
- [ ] CSP doesn't have `unsafe-inline` or `unsafe-eval`
- [ ] HSTS includes `includeSubDomains` in production
- [ ] `X-Powered-By` header removed
- [ ] Middleware composition order is correct for all stacks
- [ ] `withSession` validates all JWT claims (sub, login, role)
- [ ] `withRole` uses numeric comparison for role hierarchy
- [ ] Async context doesn't leak between requests
- [ ] `findVisiblePaper()` doesn't leak unpublished paper existence

## Step 7: Test Coverage

Check whether these critical paths are covered:
- Rate limiting (under limit, at limit, over limit)
- CSRF protection (valid origin, invalid origin, missing origin)
- Security headers present in responses
- Middleware composition (each stack produces correct behavior)
- `withSession` rejects invalid/expired JWTs
- `withRole` enforces hierarchy correctly
- `findVisiblePaper` for published/unpublished/non-existent papers

## Step 8: Report

```
### Health Score: X/5
(1=broken, 2=critical gaps, 3=notable gaps, 4=minor issues, 5=solid)

### Critical Findings
(rate limit bypass, CSRF gap, missing security headers, composition bug)

### High Priority
(IP spoofing risk, async context leak, access control inconsistency)

### Medium
(test coverage gaps, missing headers, edge cases)

### Cross-Domain Issues Found
(routes not using correct stacks, paper access inconsistency)

### Passed Checks
(explicitly list what is correct)
```
