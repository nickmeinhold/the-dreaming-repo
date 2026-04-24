/**
 * T6: Query Coverage — CLI `logs` Command Filters
 *
 * Verifies that the coKleisli side (log queries) can extract
 * verdicts from the observation monoid. Each filter dimension
 * is tested independently.
 *
 * Derived from OBSERVABILITY.md — every expressible monoid query
 * should have a corresponding test.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { runCliJson } from "./cli-helpers";
import { cleanDatabase, createTestUser } from "./helpers";
import { prisma } from "@/lib/db";

// Seed audit events directly — CLI logs reads from AuditLog table
async function seedAuditEvents() {
  const user = await createTestUser({ githubLogin: "log-user" });
  const corrId = "test-corr-001";

  await prisma.auditLog.createMany({
    data: [
      { action: "paper.submitted", entity: "paper", entityId: "2026-001", userId: user.id, correlationId: corrId, details: '{"title":"Test Paper"}' },
      { action: "paper.transitioned", entity: "paper", entityId: "2026-001", userId: user.id, correlationId: "corr-002", details: '{"from":"submitted","to":"under-review"}' },
      { action: "review.assigned", entity: "review", entityId: "2026-001", userId: user.id, correlationId: "corr-003", details: '{"reviewer":"rev-user"}' },
      { action: "note.added", entity: "note", entityId: "2026-001", userId: user.id, correlationId: "corr-004" },
      { action: "auth.login", entity: "user", entityId: String(user.id), userId: user.id, correlationId: "corr-005", details: '{"githubLogin":"log-user"}' },
      { action: "access.denied", entity: "system", entityId: "editor", userId: user.id, correlationId: "corr-006", details: '{"had":"user","needed":"editor"}' },
      { action: "system.error", entity: "system", entityId: "search", userId: null, correlationId: "corr-007", details: "Connection refused" },
    ],
  });

  return { user, corrId };
}

beforeEach(async () => {
  await cleanDatabase();
});

describe("T6: CLI logs query coverage", () => {
  test("logs recent: returns all events within time window", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{ events: unknown[]; total: number }>(
      "logs", "recent", "--last", "1h",
    );
    expect(data.total).toBe(7);
    expect(data.events).toHaveLength(7);
  });

  test("logs --entity paper: filters by entity", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{ events: { entity: string }[]; total: number }>(
      "logs", "recent", "--entity", "paper", "--last", "1h",
    );
    expect(data.total).toBe(2); // paper.submitted + paper.transitioned
    expect(data.events.every((e) => e.entity === "paper")).toBe(true);
  });

  test("logs --action paper.submitted: filters by action", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{ events: { action: string }[]; total: number }>(
      "logs", "recent", "--action", "paper.submitted", "--last", "1h",
    );
    expect(data.total).toBe(1);
    expect(data.events[0].action).toBe("paper.submitted");
  });

  test("logs --level error: returns error actions only", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{ events: { action: string }[] }>(
      "logs", "recent", "--level", "error", "--last", "1h",
    );
    // ERROR_ACTIONS = ["access.denied", "system.error", "auth.failed"]
    expect(data.events.length).toBe(2); // access.denied + system.error
    const actions = data.events.map((e) => e.action);
    expect(actions).toContain("access.denied");
    expect(actions).toContain("system.error");
  });

  test("logs --user log-user: filters by user", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{ events: { userId: number | null }[]; total: number }>(
      "logs", "recent", "--user", "log-user", "--last", "1h",
    );
    // system.error has userId: null, so it's excluded
    expect(data.total).toBe(6);
    expect(data.events.every((e) => e.userId !== null)).toBe(true);
  });

  test("logs --corr test-corr-001: filters by correlationId", async () => {
    const { corrId } = await seedAuditEvents();

    const { data } = await runCliJson<{ events: { correlationId: string }[] }>(
      "logs", "recent", "--corr", corrId, "--last", "1h",
    );
    expect(data.events).toHaveLength(1);
    expect(data.events[0].correlationId).toBe(corrId);
  });

  test("logs summary: grouped breakdown with counts", async () => {
    await seedAuditEvents();

    const { data } = await runCliJson<{
      totalEvents: number;
      errors: number;
      activeUsers: number;
      breakdown: { action: string; count: number }[];
    }>("logs", "summary", "--last", "1h");

    expect(data.totalEvents).toBe(7);
    expect(data.errors).toBe(2); // access.denied + system.error
    expect(data.activeUsers).toBe(1);
    expect(data.breakdown.length).toBeGreaterThan(0);
    // Each action appears once in our seed data
    const submittedEntry = data.breakdown.find((b) => b.action === "paper.submitted");
    expect(submittedEntry?.count).toBe(1);
  });
});
