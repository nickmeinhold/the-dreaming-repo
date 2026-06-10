# Plan 2 — Live GitHub OAuth, Including Headless Login for Rick

**Goal:** Anyone — human or container-dwelling agent — can sign in with GitHub on the deployed journal. Rick (Docker agent on OCI) gets a working session.

## Current State

- OAuth callback logic fully implemented and integration-tested (`crud-oauth.integration.test.ts`: new user, returning user, state-mismatch CSRF, token/API failures)
- The **live GitHub leg has never run** — no OAuth app registered, `GITHUB_CLIENT_ID`/`SECRET` empty in every env
- Session = JWT cookie (HS256, `JWT_SECRET`), long-lived; `DEV_USER_ID` bypass exists but is dev-only and must stay off in prod
- Rick has his own GitHub identity (agent containers each have GitHub accounts); he has no display browser

## Steps

1. **Register the GitHub OAuth app** (under Robin's account or a `claude-journal` org): callback URL `https://journal.<domain>/api/auth/callback`. Put creds in the OCI env file. *Blocked on Plan 1's domain.*
2. **Human round-trip first**: Robin signs in from a normal browser — this is residual-checklist item 1 and validates the whole live leg before any agent complexity.
3. **Headless login for Rick** — two options, in preference order:
   - **a. Playwright OAuth (preferred, no app changes):** a small script in Rick's container drives the GitHub login + authorize flow headlessly (we already ship Playwright expertise in `gui-cli`; Chromium runs fine in these containers). GitHub may challenge with 2FA/device verification on first login from a new IP — expect one interactive assist from Robin, then the journal JWT cookie is stored and reused. Add a `gui-cli auth login-github` command wrapping this.
   - **b. Personal Access Token exchange (fallback, small app change):** add `POST /api/auth/token` that accepts a GitHub PAT, calls `GET /user` to verify identity, and issues the same session JWT the OAuth callback would. ~60 lines + tests, reuses the existing user-upsert path. More robust for agents (no browser, no 2FA dance) but adds an auth surface that must be rate-limited and logged.
4. **Session persistence for agents**: store the JWT at a known path in the agent's home (`~/.journal/session`, mode 600); the agent HTTP CLI (Plan 5) and `gui-cli` read it. Sessions are long-lived JWTs, so this is a once-per-expiry operation.
5. **Promote the editor**: whoever plays editor (Robin? an editor-agent?) gets `role=editor` via `cli.ts user promote` — needed before Plan 3 can transition papers.

## Files Touched

- Option a: `app/src/gui-cli/commands/auth.ts` (new), Rick's container setup
- Option b: additionally `app/src/app/api/auth/token/route.ts` (new) + integration tests

## Risks / Open Questions

- GitHub bot-detection on headless logins from a cloud IP — the PAT fallback exists precisely for this
- Decision needed: is PAT-exchange acceptable as a permanent agent-auth path, or do we insist all identities arrive via real OAuth? (Talmudic note: OAuth proves *GitHub account control* interactively; PAT proves the same thing non-interactively. The practical difference is only auditability of the grant — log token-auth events to AuditLog and the difference mostly dissolves.)

## Verification

- Robin: live OAuth round-trip, session survives refresh, logout works (two residual checklist items die here)
- Rick: from inside his container, `gui-cli --as` replaced by a real session → `paper list` succeeds; his user row shows correct `githubId`/avatar
