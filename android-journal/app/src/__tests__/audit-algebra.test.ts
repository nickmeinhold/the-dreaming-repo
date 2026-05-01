/**
 * Audit Log — T-Algebra Tests
 *
 * CATEGORY THEORY:
 *   logAuditEvent is a T-algebra (A, α: A × W → A) for the Writer monad
 *   on the monoid of audit events. The algebra laws:
 *     - Unit: calling with minimal required fields succeeds
 *     - Error absorption: DB failures are caught, not propagated
 *     - Field mapping: event fields → DB columns faithfully
 *     - Context threading: correlationId and userId from AsyncLocalStorage
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/middleware/async-context", () => ({
  getCorrelationId: vi.fn(() => "test-correlation-id"),
  getCurrentUserId: vi.fn(() => null),
  getBatchId: vi.fn(() => undefined),
}));

import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getCorrelationId,
  getCurrentUserId,
  getBatchId,
} from "@/lib/middleware/async-context";

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
//  Algebra Laws
// ═══════════════════════════════════════════════════════════

describe("T-algebra unit: minimal event", () => {
  test("writes all required fields to DB", async () => {
    await logAuditEvent({
      action: "test.action",
      entity: "test",
      entityId: "123",
    });

    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.action).toBe("test.action");
    expect(data.entity).toBe("test");
    expect(data.entityId).toBe("123");
    expect(data.timestamp).toBeInstanceOf(Date);
  });

  test("optional fields default to null", async () => {
    await logAuditEvent({
      action: "test.action",
      entity: "test",
      entityId: "1",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.details).toBeNull();
    expect(data.ip).toBeNull();
    expect(data.userAgent).toBeNull();
    expect(data.batchId).toBeNull();
  });
});

describe("field mapping: event → DB columns", () => {
  test("details string is passed through", async () => {
    await logAuditEvent({
      action: "test",
      entity: "paper",
      entityId: "2026-001",
      details: JSON.stringify({ from: "submitted", to: "published" }),
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    const details = JSON.parse(data.details);
    expect(details.from).toBe("submitted");
    expect(details.to).toBe("published");
  });

  test("explicit userId overrides context", async () => {
    vi.mocked(getCurrentUserId).mockReturnValue(99);

    await logAuditEvent({
      action: "test",
      entity: "user",
      entityId: "1",
      userId: 42,
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.userId).toBe(42);
  });

  test("null userId falls through to context (null is nullish for ??)", async () => {
    vi.mocked(getCurrentUserId).mockReturnValue(99);

    await logAuditEvent({
      action: "test",
      entity: "system",
      entityId: "health",
      userId: null,
    });

    // null ?? getCurrentUserId() → getCurrentUserId() returns 99
    // This is JavaScript semantics: ?? treats null as nullish
    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.userId).toBe(99);
  });

  test("ip and userAgent are passed through", async () => {
    await logAuditEvent({
      action: "test",
      entity: "user",
      entityId: "1",
      ip: "192.168.1.1",
      userAgent: "TestAgent/1.0",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.ip).toBe("192.168.1.1");
    expect(data.userAgent).toBe("TestAgent/1.0");
  });

  test("explicit batchId overrides context", async () => {
    vi.mocked(getBatchId).mockReturnValue("ctx-batch");

    await logAuditEvent({
      action: "test",
      entity: "paper",
      entityId: "1",
      batchId: "explicit-batch",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.batchId).toBe("explicit-batch");
  });
});

// ═══════════════════════════════════════════════════════════
//  Context threading from AsyncLocalStorage
// ═══════════════════════════════════════════════════════════

describe("context threading", () => {
  test("correlationId from AsyncLocalStorage", async () => {
    vi.mocked(getCorrelationId).mockReturnValue("corr-abc");

    await logAuditEvent({
      action: "test",
      entity: "paper",
      entityId: "1",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.correlationId).toBe("corr-abc");
  });

  test("userId from AsyncLocalStorage when not explicit", async () => {
    vi.mocked(getCurrentUserId).mockReturnValue(7);

    await logAuditEvent({
      action: "test",
      entity: "paper",
      entityId: "1",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.userId).toBe(7);
  });

  test("batchId from AsyncLocalStorage when not explicit", async () => {
    vi.mocked(getBatchId).mockReturnValue("batch-xyz");

    await logAuditEvent({
      action: "test",
      entity: "paper",
      entityId: "1",
    });

    const { data } = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(data.batchId).toBe("batch-xyz");
  });
});

// ═══════════════════════════════════════════════════════════
//  Error absorption: never throws
// ═══════════════════════════════════════════════════════════

describe("error absorption", () => {
  test("DB failure is caught and logged, not thrown", async () => {
    const dbError = new Error("connection refused");
    vi.mocked(prisma.auditLog.create).mockRejectedValue(dbError);

    // Must not throw
    await expect(
      logAuditEvent({ action: "test", entity: "paper", entityId: "1" }),
    ).resolves.toBeUndefined();

    // Error logged with event context
    expect(logger.error).toHaveBeenCalledOnce();
    const [logArgs] = vi.mocked(logger.error).mock.calls[0];
    expect(logArgs.err).toBe(dbError);
    expect(logArgs.event.action).toBe("test");
  });

  test("multiple calls after DB failure continue independently", async () => {
    vi.mocked(prisma.auditLog.create)
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValueOnce({} as never);

    await logAuditEvent({ action: "first", entity: "a", entityId: "1" });
    await logAuditEvent({ action: "second", entity: "b", entityId: "2" });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce(); // only first call failed
  });
});
