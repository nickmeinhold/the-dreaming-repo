-- Promote durationMs and status from details JSON to real columns on AuditLog.
-- These fields are queried by every monitoring dashboard tab; real columns
-- replace 13 ad-hoc JSON.parse sites and one fragile LIKE query.

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_action_durationMs_idx" ON "AuditLog" ("action", "durationMs");
CREATE INDEX IF NOT EXISTS "AuditLog_status_timestamp_idx"  ON "AuditLog" ("status", "timestamp");

-- Backfill existing trace rows from the JSON details field.
-- Only trace.* rows have the {status, ms, steps, error} shape.
UPDATE "AuditLog"
SET
  "status"     = details::json->>'status',
  "durationMs" = (details::json->>'ms')::INTEGER
WHERE action LIKE 'trace.%'
  AND details IS NOT NULL
  AND details LIKE '%"ms":%';
