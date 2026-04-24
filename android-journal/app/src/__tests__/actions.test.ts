/**
 * Server Action Tests
 *
 * Tests validation, auth, and business logic for all server actions.
 * Prisma and auth are mocked; we test the action logic itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup (vi.hoisted ensures these exist before vi.mock factories) ──

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
vi.mock("@/lib/paper-id", () => ({
  nextPaperId: vi.fn(() => Promise.resolve("2026-001")),
}));
vi.mock("@/lib/storage", () => ({
  storePaperFiles: vi.fn(() => Promise.resolve({ pdfPath: "uploads/papers/2026-001/paper.pdf", latexPath: null })),
  getAbsolutePdfPath: vi.fn((p: string) => `/app/${p}`),
  UPLOADS_BASE: "/app/uploads",
}));

import { addNote, toggleFavourite, markAsRead } from "@/lib/actions/social";
import { submitReview } from "@/lib/actions/reviews";
import { updatePaperStatus, assignReviewer } from "@/lib/actions/editorial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mp = mockPrisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.$transaction as any).mockImplementation((f: any) => f(mockPrisma));
  mockSessionRef.current = null;
});

// ═══════════════════════════════════════════════════════════
//  addNote
// ═══════════════════════════════════════════════════════════

describe("addNote", () => {
  it("requires authentication", async () => {
    const result = await addNote("2026-001", "hello");
    expect(result).toEqual({ success: false, error: "Authentication required" });
  });

  it("rejects empty content", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await addNote("2026-001", "   ");
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects content over 10K characters", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await addNote("2026-001", "x".repeat(10_001));
    expect(result.success).toBe(false);
    expect(result.error).toContain("10");
  });

  it("rejects note on non-existent paper", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue(null);

    const result = await addNote("2026-999", "hello");
    expect(result).toEqual({ success: false, error: "Paper not found" });
  });

  it("creates note on valid paper", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.note.create.mockResolvedValue({});

    const result = await addNote("2026-001", "Great paper!");
    expect(result.success).toBe(true);
    expect(mp.note.create).toHaveBeenCalledWith({
      data: {
        content: "Great paper!",
        paperId: 42,
        userId: 1,
        parentId: null,
      },
    });
  });

  it("validates parent note belongs to same paper", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.note.findUnique.mockResolvedValue({ paperId: 99 }); // different paper

    const result = await addNote("2026-001", "Reply", 5);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid parent note");
  });
});

// ═══════════════════════════════════════════════════════════
//  toggleFavourite
// ═══════════════════════════════════════════════════════════

describe("toggleFavourite", () => {
  it("unfavourites when existing favourite is found", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.favourite.deleteMany.mockResolvedValue({ count: 1 });

    const result = await toggleFavourite("2026-001");
    expect(result).toEqual({ success: true, favourited: false });
  });

  it("favourites when no existing favourite", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.favourite.deleteMany.mockResolvedValue({ count: 0 });
    mp.favourite.create.mockResolvedValue({});

    const result = await toggleFavourite("2026-001");
    expect(result).toEqual({ success: true, favourited: true });
  });

  it("handles P2002 gracefully on concurrent favourite", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.favourite.deleteMany.mockResolvedValue({ count: 0 });

    const p2002 = new Error("Unique constraint");
    Object.assign(p2002, { code: "P2002" });
    mp.favourite.create.mockRejectedValue(p2002);

    const result = await toggleFavourite("2026-001");
    expect(result).toEqual({ success: true, favourited: true });
  });
});

// ═══════════════════════════════════════════════════════════
//  markAsRead
// ═══════════════════════════════════════════════════════════

describe("markAsRead", () => {
  it("updates existing download record", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.download.findFirst.mockResolvedValue({ id: 10 });
    mp.download.update.mockResolvedValue({});

    const result = await markAsRead("2026-001");
    expect(result.success).toBe(true);
    expect(mp.download.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { read: true },
    });
  });

  it("creates download+read record when no prior download", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findFirst.mockResolvedValue({ id: 42 });
    mp.download.findFirst.mockResolvedValue(null);
    mp.download.create.mockResolvedValue({});

    const result = await markAsRead("2026-001");
    expect(result.success).toBe(true);
    expect(mp.download.create).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
//  submitReview — Validation
// ═══════════════════════════════════════════════════════════

describe("submitReview validation", () => {
  const validReview = {
    noveltyScore: 3,
    correctnessScore: 4,
    clarityScore: 5,
    significanceScore: 3,
    priorWorkScore: 4,
    summary: "Good paper",
    strengths: "Novel approach",
    weaknesses: "Needs examples",
    questions: "",
    connections: "",
    verdict: "accept",
    buildOn: "",
  };

  it("rejects scores out of range", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await submitReview("2026-001", { ...validReview, noveltyScore: 6 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid verdict", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await submitReview("2026-001", { ...validReview, verdict: "maybe" });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await submitReview("2026-001", { ...validReview, summary: "" });
    expect(result.success).toBe(false);
  });

  it("rejects text fields over 20K characters", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await submitReview("2026-001", { ...validReview, summary: "x".repeat(20_001) });
    expect(result.success).toBe(false);
  });

  it("rejects paper not under review", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "submitted" });

    const result = await submitReview("2026-001", validReview);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Paper is not under review");
  });

  it("rejects unassigned reviewer", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "under-review" });
    mp.review.findUnique.mockResolvedValue(null);

    const result = await submitReview("2026-001", validReview);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not been assigned");
  });
});

// ═══════════════════════════════════════════════════════════
//  updatePaperStatus
// ═══════════════════════════════════════════════════════════

describe("updatePaperStatus", () => {
  it("rejects non-editor", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "user", role: "user" };
    const result = await updatePaperStatus("2026-001", "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Editor role required");
  });

  it("rejects invalid transition", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique.mockResolvedValue({ role: "editor" });
    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "submitted" });

    const result = await updatePaperStatus("2026-001", "published");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot transition");
  });

  it("reports concurrent modification", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique.mockResolvedValue({ role: "editor" });
    mp.paper.findUnique.mockResolvedValue({ id: 1, status: "submitted" });
    mp.paper.updateMany.mockResolvedValue({ count: 0 });

    const result = await updatePaperStatus("2026-001", "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toContain("concurrently");
  });
});

// ═══════════════════════════════════════════════════════════
//  assignReviewer
// ═══════════════════════════════════════════════════════════

describe("assignReviewer", () => {
  it("rejects non-editor", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "user", role: "user" };
    const result = await assignReviewer("2026-001", "reviewer");
    expect(result.success).toBe(false);
  });

  it("rejects non-existent user", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique
      .mockResolvedValueOnce({ role: "editor" })  // verifyEditorRole
      .mockResolvedValueOnce(null);                // user lookup

    const result = await assignReviewer("2026-001", "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");
  });

  it("rejects already-assigned reviewer", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique
      .mockResolvedValueOnce({ role: "editor" })
      .mockResolvedValueOnce({ id: 2 });
    mp.paper.findUnique.mockResolvedValue({ id: 42, status: "under-review" });
    mp.paperAuthor.findUnique.mockResolvedValue(null);
    mp.review.findUnique.mockResolvedValue({ id: 1 }); // already assigned

    const result = await assignReviewer("2026-001", "reviewer");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Already assigned");
  });

  it("creates placeholder review on success", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique
      .mockResolvedValueOnce({ role: "editor" })
      .mockResolvedValueOnce({ id: 2 });
    mp.paper.findUnique.mockResolvedValue({ id: 42, status: "under-review" });
    mp.paperAuthor.findUnique.mockResolvedValue(null);
    mp.review.findUnique.mockResolvedValue(null);
    mp.review.create.mockResolvedValue({});

    const result = await assignReviewer("2026-001", "reviewer");
    expect(result.success).toBe(true);
    expect(mp.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paperId: 42,
          reviewerId: 2,
          verdict: "pending",
        }),
      }),
    );
  });

  it("rejects paper not under review", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique
      .mockResolvedValueOnce({ role: "editor" })
      .mockResolvedValueOnce({ id: 2 });
    mp.paper.findUnique.mockResolvedValue({ id: 42, status: "submitted" });

    const result = await assignReviewer("2026-001", "reviewer");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Paper must be under review to assign reviewers");
  });

  it("rejects assigning paper author as reviewer", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "editor", role: "editor" };
    mp.user.findUnique
      .mockResolvedValueOnce({ role: "editor" })
      .mockResolvedValueOnce({ id: 2 });
    mp.paper.findUnique.mockResolvedValue({ id: 42, status: "under-review" });
    mp.paperAuthor.findUnique.mockResolvedValue({ paperId: 42, userId: 2 }); // is an author

    const result = await assignReviewer("2026-001", "author-login");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Cannot assign a paper's author as reviewer");
  });
});

// ═══════════════════════════════════════════════════════════
//  submitReview — Float score rejection
// ═══════════════════════════════════════════════════════════

describe("submitReview — integer enforcement", () => {
  it("rejects float scores", async () => {
    mockSessionRef.current ={ userId: 1, githubLogin: "test", role: "user" };
    const result = await submitReview("2026-001", {
      noveltyScore: 3.5,
      correctnessScore: 4,
      clarityScore: 5,
      significanceScore: 3,
      priorWorkScore: 4,
      summary: "Good paper",
      strengths: "Novel approach",
      weaknesses: "Needs examples",
      questions: "",
      connections: "",
      verdict: "accept",
      buildOn: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("integer");
  });
});
