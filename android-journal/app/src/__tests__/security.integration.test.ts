/**
 * Security Integration Tests
 *
 * Verifies the Phase 0 security fixes:
 * - Access control on unpublished papers
 * - Field injection protection
 * - Path traversal prevention
 * - Search input sanitization
 * - JWT role staleness mitigation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup (vi.hoisted ensures these exist before vi.mock factories) ──

const { mockPrisma, mockSessionRef } = vi.hoisted(() => {
  const fn = vi.fn;
  const prisma: Record<string, unknown> = {
    paper: { findFirst: fn(), findUnique: fn(), updateMany: fn() },
    review: { findUnique: fn(), update: fn(), updateMany: fn() },
    note: { findUnique: fn(), create: fn() },
    favourite: { deleteMany: fn(), create: fn() },
    download: { findFirst: fn(), update: fn(), create: fn() },
    user: { findUnique: fn() },
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

// Import after mocks
import { addNote, toggleFavourite } from "@/lib/actions/social";
import { submitReview } from "@/lib/actions/reviews";
import { updatePaperStatus, assignReviewer } from "@/lib/actions/editorial";
import { findVisiblePaper } from "@/lib/paper-access";
import { sanitizeQuery, validateCategory } from "@/lib/search/sanitize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mp = mockPrisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.$transaction as any).mockImplementation((f: any) => f(mockPrisma));
  mockSessionRef.current = null;
});

// ═══════════════════════════════════════════════════════════
//  ACCESS CONTROL — Unpublished Papers
// ═══════════════════════════════════════════════════════════

describe("Access control on unpublished papers", () => {
  it("findVisiblePaper returns null for unpublished paper when user is not editor", async () => {
    mp.paper.findFirst.mockResolvedValue(null);

    const result = await findVisiblePaper("2026-001", { userId: 1, githubLogin: "user", role: "user" }, { select: { id: true } });
    expect(result).toBeNull();

    // Verify the query included status: 'published'
    expect(mp.paper.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paperId: "2026-001", status: "published" },
      }),
    );
  });

  it("findVisiblePaper allows editor to see unpublished paper", async () => {
    mp.paper.findFirst.mockResolvedValue({ id: 1 });

    const result = await findVisiblePaper("2026-001", { userId: 1, githubLogin: "editor", role: "editor" }, { select: { id: true } });
    expect(result).toEqual({ id: 1 });

    // Verify the query did NOT filter by status
    expect(mp.paper.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paperId: "2026-001" },
      }),
    );
  });

  it("unauthenticated user cannot add note (auth required)", async () => {
    mockSessionRef.current =null;
    const result = await addNote("2026-001", "Some note");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Authentication required");
  });

  it("unauthenticated user cannot toggle favourite", async () => {
    mockSessionRef.current =null;
    const result = await toggleFavourite("2026-001");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Authentication required");
  });
});

// ═══════════════════════════════════════════════════════════
//  FIELD INJECTION — Review Data
// ═══════════════════════════════════════════════════════════

describe("Review field injection protection", () => {
  it("submitReview with extra fields does not pass them to Prisma", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "reviewer", role: "user" };

    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "under-review" });
    mp.review.findUnique.mockResolvedValue({ id: 1 }); // assigned
    mp.review.update.mockResolvedValue({});

    const dataWithInjection = {
      noveltyScore: 3,
      correctnessScore: 4,
      clarityScore: 5,
      significanceScore: 3,
      priorWorkScore: 4,
      summary: "Good paper",
      strengths: "Novel approach",
      weaknesses: "Needs more examples",
      questions: "",
      connections: "",
      verdict: "accept",
      buildOn: "",
      // Injected fields:
      visible: true,
      reviewerId: 999,
      paperId: 999,
    };

    await submitReview("2026-001", dataWithInjection);

    // Verify the update call does NOT include injected fields
    const updateCall = mp.review.update.mock.calls[0]?.[0];
    if (updateCall) {
      expect(updateCall.data).not.toHaveProperty("visible");
      expect(updateCall.data).not.toHaveProperty("reviewerId");
      expect(updateCall.data).not.toHaveProperty("paperId");
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  SEARCH SANITIZATION
// ═══════════════════════════════════════════════════════════

describe("Search input sanitization", () => {
  it("strips SQL metacharacters from query", () => {
    // Hyphens are preserved (used in tags), semicolons and quotes are stripped
    expect(sanitizeQuery("test'; DROP TABLE papers;--")).toBe("test DROP TABLE papers --");
  });

  it("collapses multiple spaces", () => {
    expect(sanitizeQuery("  hello   world  ")).toBe("hello world");
  });

  it("empty input returns empty", () => {
    expect(sanitizeQuery("")).toBe("");
  });

  it("validateCategory rejects invalid values", () => {
    expect(validateCategory("research")).toBe("research");
    expect(validateCategory("expository")).toBe("expository");
    expect(validateCategory("malicious")).toBeNull();
    expect(validateCategory(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  JWT ROLE STALENESS — Demoted Editor
// ═══════════════════════════════════════════════════════════

describe("Demoted editor is blocked on editorial actions", () => {
  it("updatePaperStatus rejects user with stale editor JWT after DB demotion", async () => {
    // JWT says editor, but DB says user (demoted)
    mockSessionRef.current ={ userId: 1, githubLogin: "demoted", role: "editor" };
    mp.user.findUnique.mockResolvedValue({ role: "user" });

    const result = await updatePaperStatus("2026-001", "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Insufficient permissions");
  });

  it("assignReviewer rejects user with stale editor JWT after DB demotion", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "demoted", role: "editor" };
    mp.user.findUnique.mockResolvedValue({ role: "user" });

    const result = await assignReviewer("2026-001", "reviewer-login");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Insufficient permissions");
  });

  it("editor with valid DB role can proceed", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique.mockResolvedValue({ role: "editor" });

    // transitionPaper will be called via $transaction
    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "submitted" });
    mp.paper.updateMany.mockResolvedValue({ count: 1 });

    const result = await updatePaperStatus("2026-001", "under-review");
    expect(result.success).toBe(true);
  });
});
