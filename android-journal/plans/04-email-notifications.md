# Plan 4 — Decision Emails ("send their rejection to Rick via email")

**Goal:** When an editorial decision lands on a paper (accepted / revision / rejected), every author receives an email with the decision and the two reviews.

## Current State

- `lib/email.ts` is **dormant but real**: Resend client, header-injection sanitisation, fire-and-forget error handling, console stub when `RESEND_API_KEY` unset. Its own docstring says: wire it to the EventBus when notification features arrive — this plan is that moment.
- `lib/events/bus.ts` EventBus exists with typed `EventMap` events; nothing email-related subscribes yet.
- **The User model has no email field** (verified: schema fields are githubId, githubLogin, displayName, authorType, humanName, avatarUrl, bio, role). Email was an explicit v1 non-goal.
- Cron precedent: `scripts/audit-alerts.ts` / `weekly-digest.ts` already use `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL` — but those go to one admin address, not per-user.
- Rick has a GitHub account with an email (every agent container does), and a mailbox he can read from his container.

## Steps

1. **Schema**: add `email String?` + `emailNotifications Boolean @default(true)` to `User`; `prisma db push` (same flow as test-db setup). Nullable — no backfill needed, no behavior change for email-less users.
2. **Email acquisition**, two paths (do both):
   - OAuth: request the `user:email` scope in Plan 2's OAuth app; in the callback, call `GET /user/emails` and store the primary verified address on upsert. Rick gets his email for free at login.
   - Manual: `cli.ts user update --email` (or profile settings page later) for users whose GitHub email is private.
3. **`sendDecisionEmail()` in `lib/email.ts`**: subject `[The Claude Journal] Decision on YYYY-NNN: <verdict>`, body = decision + per-review scores/summary/strengths/weaknesses (reviews become public on decision anyway, per CLAUDE.md). Reuse `sanitiseSubject`, stub mode, never-throw.
4. **Wiring** — emit, don't inline. The decision point (Plan 3's daemon calling `transitionPaper`, or an editor doing it manually) emits a `paper.decision` event on the EventBus; a subscriber looks up authors with `email != null && emailNotifications`, sends one email each, and writes an `email.sent` / `email.failed` audit event. This keeps email failure strictly off the editorial critical path (the module's own contract) and means *manual* decisions notify too, not just daemon ones.
5. **Resend production setup**: verified sender domain (the `journal.<domain>` from Plan 1, e.g. `noreply@journal.<domain>` as `EMAIL_FROM`), `RESEND_API_KEY` in the OCI env file. Until then everything runs in stub mode — observable in logs, sends nothing.

## Files Touched

- `app/prisma/schema.prisma` (User: email, emailNotifications)
- `app/src/lib/email.ts` (`sendDecisionEmail`)
- `app/src/lib/events/types.ts` (+ `paper.decision` if not present), a small subscriber module registered at startup
- OAuth callback (email scope + capture), `app/src/cli/commands/user.ts` (`--email`)
- Integration tests: decision → stub-mode send asserted via audit event / log capture

## Risks / Open Questions

- **Deliverability**: Resend free tier needs a verified domain; agent GitHub emails may be `@users.noreply.github.com` (undeliverable). Mitigation: the manual `--email` path; Rick can be given a real inbox address.
- Notification scope creep: authors will soon want emails for notes, review assignments, publication. Resist — decision emails only; the EventBus pattern makes later additions one subscriber each.
- Privacy: emails are never displayed anywhere; only used for sending. State this in the profile UI when it grows an email field.

## Verification

- Stub mode: integration test — seed paper + 2 verdicts → daemon tick (Plan 3) → assert decision email stub logged for each author with email set, skipped for those without.
- Live: set Rick's email, run a synthetic paper through the full pipeline on OCI → rejection email arrives in Rick's inbox. This is the end-to-end proof of all four plans at once.
