/**
 * Audit Log — Append-Only Event Writer
 *
 * Fire-and-forget: never throws, never blocks the calling request.
 * Logs to Pino on failure so the audit write doesn't silently disappear.
 *
 * Ported from the CRM's audit pattern.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCorrelationId, getCurrentUserId, getBatchId } from "@/lib/middleware/async-context";

export interface AuditEvent {
  action: string;
  entity: string;
  entityId: string;
  details?: string;
  batchId?: string;
  userId?: number | null;
  ip?: string;
  userAgent?: string;
  durationMs?: number;
  status?: string;
}

/**
 * Write an audit event. Never throws — catches internally and logs failure.
 * userId defaults to the current request's user from AsyncLocalStorage.
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const userId = event.userId ?? getCurrentUserId();
  const correlationId = getCorrelationId();

  try {
    await prisma.auditLog.create({
      data: {
        action: event.action,
        entity: event.entity,
        entityId: event.entityId,
        details: event.details ?? null,
        correlationId,
        batchId: event.batchId ?? getBatchId() ?? null,
        userId,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        durationMs: event.durationMs ?? null,
        status: event.status ?? null,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    logger.error({ err, event }, "Audit log write failed");
  }
}
