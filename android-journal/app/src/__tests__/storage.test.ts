/**
 * Storage Atomicity Tests
 *
 * Verifies that file storage failures don't leave the DB
 * in an inconsistent state (Phase 2.6 fix).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup (vi.hoisted ensures these exist before vi.mock factories) ──

const { mockPrisma, mockSessionRef, mockStorePaperFiles } = vi.hoisted(() => {
  const fn = vi.fn;
  const prisma: Record<string, unknown> = {
    paper: { create: fn(), delete: fn() },
    paperAuthor: { create: fn() },
    paperTag: { create: fn() },
    tag: { upsert: fn() },
    user: { findUnique: fn() },
    $transaction: fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$transaction as any).mockImplementation((f: any) => f(prisma));
  return {
    mockPrisma: prisma,
    mockSessionRef: { current: null as { userId: number; githubLogin: string; role: string } | null },
    mockStorePaperFiles: fn(),
  };
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
  storePaperFiles: (...args: unknown[]) => mockStorePaperFiles(...args),
  getAbsolutePdfPath: vi.fn(),
  UPLOADS_BASE: "/app/uploads",
}));
vi.mock("@/lib/constants", () => ({
  MAX_PDF_SIZE: 50 * 1024 * 1024,
  getJwtSecret: vi.fn(),
  COOKIE_NAME: "session",
  SESSION_DURATION: "8h",
  SESSION_MAX_AGE: 28800,
}));

import { submitPaper } from "@/lib/actions/papers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mp = mockPrisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.$transaction as any).mockImplementation((f: any) => f(mockPrisma));
  mockSessionRef.current = { userId: 1, githubLogin: "test", role: "user" };
  mp.user.findUnique.mockResolvedValue({
    id: 1,
    displayName: "Test",
    authorType: "human",
    githubLogin: "test",
    humanName: null,
  });
  mp.paper.create.mockResolvedValue({ id: 1 });
  mp.tag.upsert.mockResolvedValue({ id: 1 });
  mp.paperTag.create.mockResolvedValue({});
  mp.paperAuthor.create.mockResolvedValue({});
  mockStorePaperFiles.mockResolvedValue({
    pdfPath: "uploads/papers/2026-001/paper.pdf",
    latexPath: null,
  });
});

function makePdfFormData(): FormData {
  const form = new FormData();
  form.set("title", "Test Paper");
  form.set("abstract", "Test abstract");
  form.set("category", "research");
  form.set("tags", "test");

  // Create a minimal PDF buffer (%PDF- magic bytes)
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
  const pdfFile = new File([pdfBytes], "paper.pdf", { type: "application/pdf" });
  form.set("pdf", pdfFile);

  return form;
}

describe("Storage atomicity", () => {
  it("successful submission stores files and creates DB record", async () => {
    const result = await submitPaper(makePdfFormData());
    expect(result.success).toBe(true);
    expect(result.paperId).toBe("2026-001");
    expect(mockStorePaperFiles).toHaveBeenCalled();
  });

  it("file storage failure triggers DB rollback (paper deletion)", async () => {
    mockStorePaperFiles.mockRejectedValue(new Error("Disk full"));
    mp.paper.delete.mockResolvedValue({});

    await expect(submitPaper(makePdfFormData())).rejects.toThrow("Disk full");

    // Verify the paper record was deleted as cleanup
    expect(mp.paper.delete).toHaveBeenCalledWith({
      where: { paperId: "2026-001" },
    });
  });

  it("file paths are included in initial paper.create", async () => {
    await submitPaper(makePdfFormData());

    expect(mp.paper.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdfPath: "uploads/papers/2026-001/paper.pdf",
        }),
      }),
    );
  });
});
