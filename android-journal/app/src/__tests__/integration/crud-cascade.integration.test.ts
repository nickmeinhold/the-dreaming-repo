/**
 * CRUD Audit — Cascade & Referential Integrity Tests
 *
 * Tests the onDelete behaviour defined in the Prisma schema.
 * These edge cases were identified by /crud-audit as completely untested:
 * - D4: Cascading relationships on paper delete
 * - D7: Delete while referenced (FK Restrict on user)
 * - X4: Transaction rollback on file storage failure
 * - C11: Atomicity of paper submission
 *
 * Integration tests against real PostgreSQL.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storePaperFiles: vi.fn() }));

import { prisma } from "@/lib/db";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
});

describe("CRUD audit: Paper cascade deletes (D4)", () => {
  test("deleting a paper cascades to notes, favourites, downloads, tags", async () => {
    // CRUD audit: D4 — cascading relationships
    const author = await createTestUser({ githubLogin: "cascade-author" });
    const reader = await createTestUser({ githubLogin: "cascade-reader" });
    const paper = await createTestPaper(author.id, { status: "published" });

    // Create child records across all cascade relationships
    await prisma.note.create({
      data: { content: "A note", paperId: paper.id, userId: reader.id },
    });
    await prisma.favourite.create({
      data: { paperId: paper.id, userId: reader.id },
    });
    await prisma.download.create({
      data: { paperId: paper.id, userId: reader.id, read: true },
    });

    // Verify children exist
    expect(await prisma.note.count({ where: { paperId: paper.id } })).toBe(1);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(1);
    expect(await prisma.download.count({ where: { paperId: paper.id } })).toBe(1);

    // Delete the paper — must first remove PaperAuthor (Restrict via User FK)
    // Paper → PaperAuthor is Cascade, so deleting paper removes PaperAuthor too
    // Paper → Note/Favourite/Download are all Cascade
    await prisma.paper.delete({ where: { id: paper.id } });

    // All children should be gone
    expect(await prisma.note.count({ where: { paperId: paper.id } })).toBe(0);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(0);
    expect(await prisma.download.count({ where: { paperId: paper.id } })).toBe(0);
    expect(await prisma.paperAuthor.count({ where: { paperId: paper.id } })).toBe(0);
    expect(await prisma.paperTag.count({ where: { paperId: paper.id } })).toBe(0);
  });

  test("deleting a paper with reviews is blocked by Restrict", async () => {
    // CRUD audit: D7 — delete while referenced (Review → Paper is Restrict)
    const author = await createTestUser({ githubLogin: "restrict-author" });
    const reviewer = await createTestUser({ githubLogin: "restrict-reviewer" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: reviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "",
        verdict: "pending",
      },
    });

    // Paper delete should fail — Review has onDelete: Restrict
    await expect(
      prisma.paper.delete({ where: { id: paper.id } }),
    ).rejects.toThrow();

    // Paper should still exist
    const stillExists = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(stillExists).toBeTruthy();
  });
});

describe("CRUD audit: User delete cascade behaviour (D4/D7)", () => {
  test("deleting a user with authored papers is blocked by Restrict", async () => {
    // CRUD audit: D7 — PaperAuthor → User has onDelete: Restrict
    const author = await createTestUser({ githubLogin: "nodelete-author" });
    await createTestPaper(author.id);

    await expect(
      prisma.user.delete({ where: { id: author.id } }),
    ).rejects.toThrow();

    // User should still exist
    const stillExists = await prisma.user.findUnique({ where: { id: author.id } });
    expect(stillExists).toBeTruthy();
  });

  test("deleting a user with reviews is blocked by Restrict", async () => {
    // CRUD audit: D7 — Review → User has onDelete: Restrict
    const author = await createTestUser({ githubLogin: "review-author" });
    const reviewer = await createTestUser({ githubLogin: "review-reviewer" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: reviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "",
        verdict: "pending",
      },
    });

    await expect(
      prisma.user.delete({ where: { id: reviewer.id } }),
    ).rejects.toThrow();
  });

  test("deleting a user cascades notes and favourites, nulls downloads", async () => {
    // CRUD audit: D4 — Note/Favourite → Cascade, Download → SetNull
    const author = await createTestUser({ githubLogin: "delcasc-author" });
    const reader = await createTestUser({ githubLogin: "delcasc-reader" });
    const paper = await createTestPaper(author.id, { status: "published" });

    const note = await prisma.note.create({
      data: { content: "Ephemeral note", paperId: paper.id, userId: reader.id },
    });
    await prisma.favourite.create({
      data: { paperId: paper.id, userId: reader.id },
    });
    const download = await prisma.download.create({
      data: { paperId: paper.id, userId: reader.id, read: true },
    });

    // Delete the reader (no authorships or reviews → no Restrict)
    await prisma.user.delete({ where: { id: reader.id } });

    // Notes and favourites should be gone (Cascade)
    expect(await prisma.note.findUnique({ where: { id: note.id } })).toBeNull();
    expect(await prisma.favourite.count({ where: { userId: reader.id } })).toBe(0);

    // Download should still exist but userId should be null (SetNull)
    const orphanedDownload = await prisma.download.findUnique({ where: { id: download.id } });
    expect(orphanedDownload).toBeTruthy();
    expect(orphanedDownload!.userId).toBeNull();
    expect(orphanedDownload!.read).toBe(true); // data preserved
  });
});

describe("CRUD audit: Submission atomicity (C11/X4)", () => {
  test("file storage failure rolls back paper record", async () => {
    // CRUD audit: C11 + X4 — compensating delete on storePaperFiles failure
    const { getSession } = await import("@/lib/auth");
    const { storePaperFiles } = await import("@/lib/storage");
    const { submitPaper } = await import("@/lib/actions/papers");

    const user = await createTestUser({ githubLogin: "atomicity-user" });
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    // storePaperFiles is already mocked at the top of this file via vi.mock.
    // Make it reject once to simulate disk failure.
    const mockedStore = vi.mocked(storePaperFiles);
    mockedStore.mockReset();
    mockedStore.mockRejectedValueOnce(new Error("Disk full"));

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...Array(100).fill(0x00)]);
    const form = new FormData();
    form.set("title", "Doomed Paper");
    form.set("abstract", "This paper will not survive file storage failure.");
    form.set("category", "research");
    form.set("tags", "test-tag");
    form.set("pdf", new Blob([pdfBytes], { type: "application/pdf" }), "paper.pdf");

    // submitPaper throws when file storage fails (error propagates through withActionTrace)
    await expect(submitPaper(form)).rejects.toThrow("Disk full");

    // The paper record should have been cleaned up (compensating delete in catch block)
    const papers = await prisma.paper.findMany({ where: { title: "Doomed Paper" } });
    expect(papers).toHaveLength(0);

    // PaperAuthor and PaperTag should also be gone (cascade from paper delete)
    const allAuthors = await prisma.paperAuthor.count();
    expect(allAuthors).toBe(0);
  });
});
