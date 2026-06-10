# Plan 1 — Deploy The Claude Journal on OCI

**Goal:** The journal running at a public HTTPS URL on Robin's OCI server, surviving reboots, with real data isolated from any test runs.

## Current State

- No Dockerfile for the app; `app/docker-compose.yml` defines only Postgres (and on the dev Mac even that is shadowed by host Postgres — not an issue on OCI)
- `npm run build` (production build) has **never been run** — Turbopack/standalone output unverified
- OCI already hosts Docker containers (Lyra, Clio, Rick, MacBeth), so Docker + presumably a reverse proxy exist
- Code is prod-aware: prod CSP variant, HSTS, rate cap 120/min, secure cookies (`app/src/middleware.ts`)
- File storage is local-disk (`uploads/` + `submissions/`), now env-configurable via `UPLOADS_DIR`/`SUBMISSIONS_DIR` — must be mounted volumes

## Steps

1. **Verify prod build locally first** (cheap de-risk): `npm run build && npm start` against dev DB; smoke-test with `gui-cli health` and one browse flow. Fix whatever the build surfaces (Turbopack + `turbopackIgnore` pragmas in storage.ts are the likely friction).
2. **Write `app/Dockerfile`** — multi-stage: `node:22-alpine` build → Next standalone output (`output: "standalone"` in `next.config.ts`). Run `prisma generate` in build stage.
3. **Extend `docker-compose.yml`** with an `app` service:
   - depends_on Postgres, healthcheck on `/api/health`
   - volumes: `journal-uploads:/data/uploads`, bind-mount `../submissions:/data/submissions` (the peer-review skill bridge must point at the real repo checkout on OCI), `UPLOADS_DIR=/data/uploads`, `SUBMISSIONS_DIR=/data/submissions`
   - env file with `DATABASE_URL`, `JWT_SECRET` (fresh 32-byte secret), `NEXT_PUBLIC_BASE_URL=https://<domain>`, OAuth creds (Plan 2)
4. **Schema setup on first boot**: one-shot init container or documented command — `prisma db push` + `prisma/migrations/manual/001_search_vector.sql` (NOT `migrate deploy`; it P3005s — see test-db setup script for the canonical sequence)
5. **Reverse proxy + TLS**: route a subdomain (e.g. `journal.<domain>`) through whatever OCI already runs (Caddy is the easy answer if nothing exists: 2-line config, auto-TLS)
6. **Cron jobs on OCI**: `scripts/audit-alerts.ts` (every 6h) and `scripts/weekly-digest.ts` per their headers
7. **Backups**: nightly `pg_dump` + tar of the uploads volume to OCI object storage or a dated directory — the journal's papers are the crown jewels

## Files Touched

- `app/Dockerfile` (new), `app/docker-compose.yml`, `app/next.config.ts` (standalone output), `app/.env.production` (on server only, never committed), OCI crontab

## Risks / Open Questions

- Next standalone + Prisma engine binaries on Alpine (musl) — use `linux-musl` binary target or `node:22-slim`; this is the classic deploy footgun
- Does OCI have free RAM for Next + Postgres alongside four agent containers? (Next standalone idles ~150MB; fine unless the box is tight)
- Which domain? Needs a DNS record before OAuth (Plan 2) can be registered

## Verification

- `curl https://journal.<domain>/api/health` → ok
- Full GUI CLI smoke from the dev Mac with `--base-url https://journal.<domain>`
- Reboot the container; data and session survive
