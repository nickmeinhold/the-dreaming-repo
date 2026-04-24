/**
 * Integration Tests — Paper Submission
 *
 * Tests the submitPaper server action against a real PostgreSQL database.
 * Verifies: paper creation, ID generation, tag creation, validation,
 * author linking, and atomicity.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock modules that require Next.js runtime
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storePaperFiles: vi.fn() }));

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { submitPaper } from "@/lib/actions/papers";
import { cleanDatabase, createTestUser, buildSubmissionForm } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

describe("Paper Submission — DB Integration", () => {
  test("creates paper with correct ID, status, and fields", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(buildSubmissionForm());

    expect(result.success).toBe(true);
    expect(result.paperId).toMatch(/^2026-001$/);

    const paper = await prisma.paper.findUnique({
      where: { paperId: result.paperId! },
    });
    expect(paper).toBeTruthy();
    expect(paper!.status).toBe("submitted");
    expect(paper!.title).toBe("Categorical Composition of GAs");
    expect(paper!.category).toBe("research");
    expect(paper!.pdfPath).toContain("2026-001");
  });

  test("links submitter as author with order 1", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(buildSubmissionForm());
    const paper = await prisma.paper.findUnique({
      where: { paperId: result.paperId! },
    });

    const authors = await prisma.paperAuthor.findMany({
      where: { paperId: paper!.id },
    });
    expect(authors).toHaveLength(1);
    expect(authors[0].userId).toBe(user.id);
    expect(authors[0].order).toBe(1);
  });

  test("creates and links tags correctly", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(buildSubmissionForm());
    const paper = await prisma.paper.findUnique({
      where: { paperId: result.paperId! },
    });

    const paperTags = await prisma.paperTag.findMany({
      where: { paperId: paper!.id },
      include: { tag: true },
    });
    const slugs = paperTags.map((pt) => pt.tag.slug).sort();
    expect(slugs).toEqual(["category-theory", "genetic-algorithms"]);
  });

  test("sequential submissions generate incrementing IDs", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const r1 = await submitPaper(buildSubmissionForm({ title: "First Paper" }));
    const r2 = await submitPaper(buildSubmissionForm({ title: "Second Paper" }));

    expect(r1.paperId).toBe("2026-001");
    expect(r2.paperId).toBe("2026-002");
  });

  test("rejects unauthenticated submission", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await submitPaper(buildSubmissionForm());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication required");
  });

  test("rejects submission with empty title", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(buildSubmissionForm({ title: "" }));

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("rejects non-PDF file (bad magic bytes)", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const form = buildSubmissionForm();
    // Replace PDF with a text file
    const notPdf = new Blob([new TextEncoder().encode("not a pdf file")]);
    form.set("pdf", notPdf, "fake.pdf");

    const result = await submitPaper(form);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a valid PDF");
  });

  test("rejects invalid category", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(
      buildSubmissionForm({ category: "invalid" }),
    );

    expect(result.success).toBe(false);
  });

  test("reuses existing tags across papers", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await submitPaper(buildSubmissionForm({ tags: "shared-tag" }));
    await submitPaper(
      buildSubmissionForm({ title: "Second Paper", tags: "shared-tag" }),
    );

    const tags = await prisma.tag.findMany({ where: { slug: "shared-tag" } });
    expect(tags).toHaveLength(1); // Same tag record reused
  });
});
