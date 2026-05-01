-- Add batchId column to AuditLog for grouping story seed runs
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "batchId" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_batchId_idx" ON "AuditLog" ("batchId");
