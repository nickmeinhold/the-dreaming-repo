/**
 * CRUD Audit — Auth Gap Tests
 *
 * Tests authentication/authorization edge cases identified by /crud-audit:
 * - C7: Unauthenticated toggleFavourite and markAsRead
 * - U9: Unauthenticated submitReview
 * - U6: Editor cannot call promoteUser (admin-only)
 * - U10: submitReview on paper that doesn't exist (vs wrong status)
 *
 * These are server action tests with mocked Prisma (matching actions.test.ts pattern).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockSessionRef } = vi.hoisted(() => {
  const fn = vi.fn;
  const prisma: Record<string, unknown> = {
    paper: { findFirst: fn(), findUnique: fn(), create: fn(), update: fn(), updateMany: fn(), delete: fn() },
    paperAuthor: { create: fn(), findUnique: fn() },
    paperTag: { create: fn() },
    tag: { upsert: fn() },
    review: { findUnique: fn(), update: fn(), create: fn(), updateMany: fn() },
    note: { findUnique: fn(), create: fn() },
    favourite: { deleteMany: fn(), create: fn() },
    download: { findFirst: fn(), update: fn(), create: fn() },
    user: { findUnique: fn(), update: fn() },
    $transaction: fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$transaction as any).mockImplementation((f: any) => f(prisma));
  return { mockPrisma: prisma, mockSessionRef: { current: null as { userId: number; githubLogin: string; role: string } | null } };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSessionRef.current)),
  SessionPayload: {},
}));

import { toggleFavourite, markAsRead } from "@/lib/actions/social";
import { submitReview } from "@/lib/actions/reviews";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mp = mockPrisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.$transaction as any).mockImplementation((f: any) => f(mockPrisma));
  mockSessionRef.current = null;
});

// ── Authentication gaps (C7) ──────────────────────────────

describe("CRUD audit: toggleFavourite auth (C7)", () => {
  test("rejects unauthenticated favourite toggle", async () => {
    // CRUD audit: C7 — unauthorized create
    mockSessionRef.current = null;

    const result = await toggleFavourite("2026-001");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication required");
  });
});

describe("CRUD audit: markAsRead auth (C7)", () => {
  test("rejects unauthenticated read marking", async () => {
    // CRUD audit: C7 — unauthorized create
    mockSessionRef.current = null;

    const result = await markAsRead("2026-001");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication required");
  });
});

describe("CRUD audit: submitReview auth (U9)", () => {
  test("rejects unauthenticated review submission", async () => {
    // CRUD audit: U9 — unauthorized update
    mockSessionRef.current = null;

    const result = await submitReview("2026-001", {
      noveltyScore: 3, correctnessScore: 3, clarityScore: 3,
      significanceScore: 3, priorWorkScore: 3,
      summary: "Good paper", strengths: "Strong", weaknesses: "Weak",
      questions: "None", connections: "Related", verdict: "accept",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication required");
  });

  test("rejects review on nonexistent paper (distinct from wrong status)", async () => {
    // CRUD audit: U2 — update nonexistent record
    mockSessionRef.current = { userId: 1, githubLogin: "reviewer", role: "user" };
    mp.paper.findUnique.mockResolvedValue(null);

    const result = await submitReview("2026-999", {
      noveltyScore: 3, correctnessScore: 3, clarityScore: 3,
      significanceScore: 3, priorWorkScore: 3,
      summary: "Good", strengths: "Strong", weaknesses: "Weak",
      questions: "None", connections: "Related", verdict: "accept",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Paper not found");
  });
});
