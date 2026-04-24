/**
 * Integration Tests — Editorial Workflow
 *
 * Tests status transitions, reviewer assignment, side effects (publishedAt,
 * review visibility), optimistic locking, and auth guards — all against
 * a real PostgreSQL database.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { transitionPaper } from "@/lib/paper-workflow";
import { updatePaperStatus, assignReviewer } from "@/lib/actions/editorial";
import {
  cleanDatabase,
  createTestUser,
  createTestPaper,
} from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

describe("State Machine — Direct transitions", () => {
  test("happy path: submitted → under-review → accepted → published", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id);

    let result = await transitionPaper(prisma, paper.paperId, "under-review");
    expect(result.success).toBe(true);

    result = await transitionPaper(prisma, paper.paperId, "accepted");
    expect(result.success).toBe(true);

    result = await transitionPaper(prisma, paper.paperId, "published");
    expect(result.success).toBe(true);

    const final = await prisma.paper.findUnique({
      where: { paperId: paper.paperId },
    });
    expect(final!.status).toBe("published");
    expect(final!.publishedAt).toBeTruthy();
  });

  test("published is terminal — no further transitions", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    const result = await transitionPaper(prisma, paper.paperId, "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot transition");
  });

  test("invalid transition rejected (submitted → accepted)", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id);

    const result = await transitionPaper(prisma, paper.paperId, "accepted");
    expect(result.success).toBe(false);
  });

  test("revision back-edge works (under-review → revision → under-review)", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "under-review" });

    let result = await transitionPaper(prisma, paper.paperId, "revision");
    expect(result.success).toBe(true);

    result = await transitionPaper(prisma, paper.paperId, "under-review");
    expect(result.success).toBe(true);
  });

  test("sets publishedAt on publish", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "accepted" });

    const before = new Date();
    await transitionPaper(prisma, paper.paperId, "published");
    const after = new Date();

    const updated = await prisma.paper.findUnique({
      where: { paperId: paper.paperId },
    });
    expect(updated!.publishedAt).toBeTruthy();
    expect(updated!.publishedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(updated!.publishedAt!.getTime()).toBeLessThanOrEqual(
      after.getTime(),
    );
  });

  test("makes completed reviews visible on acceptance", async () => {
    const author = await createTestUser();
    const reviewer = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    // Create a completed review (non-pending)
    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: reviewer.id,
        noveltyScore: 4,
        correctnessScore: 5,
        clarityScore: 4,
        significanceScore: 3,
        priorWorkScore: 4,
        summary: "Good paper",
        strengths: "Strong theory",
        weaknesses: "Needs examples",
        questions: "",
        connections: "",
        verdict: "accept",
        visible: false,
      },
    });

    // Also create a pending placeholder (should NOT become visible)
    const pendingReviewer = await createTestUser();
    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: pendingReviewer.id,
        noveltyScore: 0,
        correctnessScore: 0,
        clarityScore: 0,
        significanceScore: 0,
        priorWorkScore: 0,
        summary: "",
        strengths: "",
        weaknesses: "",
        questions: "",
        connections: "",
        verdict: "pending",
        visible: false,
      },
    });

    await transitionPaper(prisma, paper.paperId, "accepted");

    const reviews = await prisma.review.findMany({
      where: { paperId: paper.id },
      orderBy: { reviewerId: "asc" },
    });

    const completed = reviews.find((r) => r.verdict === "accept");
    const pending = reviews.find((r) => r.verdict === "pending");
    expect(completed!.visible).toBe(true);
    expect(pending!.visible).toBe(false);
  });
});

describe("Editorial Actions — Auth + Workflow", () => {
  test("editor can transition paper status", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const result = await updatePaperStatus(paper.paperId, "under-review");
    expect(result.success).toBe(true);

    const updated = await prisma.paper.findUnique({
      where: { paperId: paper.paperId },
    });
    expect(updated!.status).toBe("under-review");
  });

  test("non-editor cannot transition paper status", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id);

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await updatePaperStatus(paper.paperId, "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Editor role required");
  });

  test("demoted editor blocked by fresh DB role check", async () => {
    const user = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);

    // JWT says editor, but DB says user (demoted)
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "editor", // stale JWT
    });

    // Demote in DB
    await prisma.user.update({
      where: { id: user.id },
      data: { role: "user" },
    });

    const result = await updatePaperStatus(paper.paperId, "under-review");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient permissions");
  });
});

describe("Reviewer Assignment", () => {
  test("assigns reviewer and creates placeholder review", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser({ githubLogin: "reviewer1" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const result = await assignReviewer(paper.paperId, "reviewer1");
    expect(result.success).toBe(true);

    const review = await prisma.review.findUnique({
      where: {
        paperId_reviewerId: { paperId: paper.id, reviewerId: reviewer.id },
      },
    });
    expect(review).toBeTruthy();
    expect(review!.verdict).toBe("pending");
    expect(review!.noveltyScore).toBe(0);
  });

  test("cannot assign author as reviewer", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser({ githubLogin: "theauthor" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const result = await assignReviewer(paper.paperId, "theauthor");
    expect(result.success).toBe(false);
    expect(result.error).toContain("author");
  });

  test("cannot assign reviewer to non-under-review paper", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser({ githubLogin: "rev2" });
    const paper = await createTestPaper(author.id); // status = submitted

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const result = await assignReviewer(paper.paperId, "rev2");
    expect(result.success).toBe(false);
    expect(result.error).toContain("under review");
  });

  test("cannot double-assign same reviewer", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser({ githubLogin: "rev3" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await assignReviewer(paper.paperId, "rev3");
    const result = await assignReviewer(paper.paperId, "rev3");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Already assigned");
  });
});
