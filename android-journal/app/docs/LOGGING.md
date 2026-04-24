# Logging & Observability

## Architecture

Three tiers of observability, each at a different cost/queryability tradeoff:

1. **AuditLog table** — queryable via Prisma, powers the monitoring dashboard and alert scanner
2. **Pino stdout** — JSON logs with auto-injected `correlationId` and `userId` via `mixin()`
3. **console.warn** — Edge middleware only (rate limits, CSRF), where Pino can't run

## What Gets Logged

### AuditLog Table

| Action | Entity | Source File | Logged After |
|--------|--------|------------|--------------|
| `paper.submitted` | paper | `actions/papers.ts` | storePaperFiles succeeds |
| `paper.transitioned` | paper | `paper-workflow.ts` | transaction succeeds (details: `{from, to}`) |
| `review.assigned` | review | `actions/editorial.ts` | placeholder review created |
| `review.submitted` | review | `actions/reviews.ts` | review updated (details: `{verdict}`) |
| `note.added` | note | `actions/social.ts` | note created |
| `paper.downloaded` | paper | `api/papers/[paperId]/download/route.ts` | before streaming response |
| `auth.login` | user | `api/auth/github/callback/route.ts` | session created |
| `auth.failed` | user | `api/auth/github/callback/route.ts` | OAuth state mismatch or token failure |
| `access.denied` | system | `middleware/with-role.ts` | role check fails (403) |
| `system.error` | system | `middleware/builder.ts` | unhandled exception in route |

### Pino Stdout Only

| Event | Source | Reason |
|-------|--------|--------|
| Audit write failure | `lib/audit.ts` | Meta-logging: audit itself failed |
| Unhandled route error | `middleware/builder.ts` | Full stack trace with correlationId |
| Download log failure | `api/.../download/route.ts` | Download table write failed |

### Edge Middleware (console.warn)

| Event | Source | Reason |
|-------|--------|--------|
| Rate limit hit (429) | `middleware.ts` | Edge runtime, can't use Pino |
| CSRF rejection (403) | `middleware.ts` | Edge runtime, can't use Pino |

### NOT Logged

| Event | Reason |
|-------|--------|
| Page views / GET requests | Too noisy, no signal |
| Favourites | High volume, low stakes |
| Read-marking | High volume, low stakes |
| Search queries | Not audit-relevant (add later for analytics if needed) |

## Audit Module

`src/lib/audit.ts` — single `logAuditEvent()` function.

- **Fire-and-forget**: never throws, catches errors internally
- **Auto-resolves userId** from AsyncLocalStorage if not explicitly provided
- **Append-only**: the AuditLog table is never updated or deleted from in application code

## Alert Scanner

`scripts/audit-alerts.ts` — standalone cron script (not part of the Next.js app).

Runs every 6 hours. Applies 5 rules:

| # | Rule | Condition | Severity |
|---|------|-----------|----------|
| 1 | Stale submissions | Paper in `submitted` >3 days | MEDIUM |
| 2 | Stale reviews | Reviewer assigned >7 days, all scores zero | MEDIUM |
| 3 | Access denied | Any `access.denied` in scan window | HIGH |
| 4 | System errors | 3+ `system.error` in scan window | HIGH |
| 5 | Publication | Paper transitioned to published | INFO |

Sends email via Resend. Stub mode (console output) when `RESEND_API_KEY` is not set.

## Weekly Digest

`scripts/weekly-digest.ts` — runs Monday 8am.

Always sends. Covers: submissions, publications, reviews completed, downloads, stale items, errors.

## Monitoring Dashboard

`/admin/monitoring` — admin-only server component.

4 sections:
1. **Pipeline** — paper counts by status
2. **Attention Required** — stale submissions (>3d) and stale reviews (>7d)
3. **Recent Activity** — last 50 audit events
4. **Errors (7d)** — system error and access denied counts

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ALERT_EMAIL` | For alerts/digest | — | Recipient for alert and digest emails |
| `RESEND_API_KEY` | No | — | Resend API key. Stub mode without it |
| `EMAIL_FROM` | No | `noreply@claude-journal.dev` | Sender address |
| `ALERT_WINDOW_HOURS` | No | `6` | Alert scanner lookback window |
| `LOG_LEVEL` | No | `info` | Pino log level |

## Cron Setup

```crontab
# Alert scanner — every 6 hours
0 0,6,12,18 * * * cd /path/to/journal/app && npx tsx scripts/audit-alerts.ts

# Weekly digest — Monday 8am
0 8 * * 1 cd /path/to/journal/app && npx tsx scripts/weekly-digest.ts
```
