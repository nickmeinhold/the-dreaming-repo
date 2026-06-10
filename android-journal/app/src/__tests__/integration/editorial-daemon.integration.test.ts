/**
 * Editorial Daemon Integration Tests (Plan 3)
 *
 * The daemon's tick functions against the real test database:
 *   tickSubmitted   — submitted → under-review + referee assignment
 *   tickUnderReview — unanimous verdicts decided, mixed flagged once
 *   decideVerdicts  — the pure decision rule
 * Plus GET /api/reviews/pending — the referee's work-queue discovery.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

process.env.JWT_SECRET =
  "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: vi.fn(() => null) })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { getJwtSecret } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  decideVerdicts,
  selectReferees,
  tickSubmitted,
  tickUnderReview,
  MANUAL_REVIEW_TAG,
} from "@/lib/editorial/daemon";
import { GET as pendingReviews } from "@/app/api/reviews/pending/route";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

const CONFIG = { refereePool: [] as string[], refereesPerPaper: 2 };

async function setVerdict(paperDbId: number, reviewerId: number, verdict: string) {
  await prisma.review.update({
    where: { paperId_reviewerId: { paperId: paperDbId, reviewerId } },
    data: { verdict, noveltyScore: 3, correctnessScore: 3, clarityScore: 3, significanceScore: 3, priorWorkScore: 3 },
  });
}

async function tagManualReview(paperDbId: number) {
  const tag = await prisma.tag.upsert({
    where: { slug: MANUAL_REVIEW_TAG },
    update: {},
    create: { slug: MANUAL_REVIEW_TAG, label: "Manual Review" },
  });
  await prisma.paperTag.create({ data: { paperId: paperDbId, tagId: tag.id } });
}

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

// ── decideVerdicts (pure) ─────────────────────────────────

describe("decideVerdicts", () => {
  test("waits while any verdict is pending or count short", () => {
    expect(decideVerdicts(["pending", "accept"], 2)).toBe("wait");
    expect(decideVerdicts(["accept"], 2)).toBe("wait");
    expect(decideVerdicts([], 2)).toBe("wait");
  });

  test("unanimous accept → accepted", () => {
    expect(decideVerdicts(["accept", "accept"], 2)).toBe("accepted");
  });

  test("unanimous reject → revision", () => {
    expect(decideVerdicts(["reject", "reject"], 2)).toBe("revision");
  });

  test("mixed verdicts → flag (editor judgment)", () => {
    expect(decideVerdicts(["accept", "reject"], 2)).toBe("flag");
    expect(decideVerdicts(["accept", "minor-revision"], 2)).toBe("flag");
    expect(decideVerdicts(["major-revision", "major-revision"], 2)).toBe("flag");
  });
});

// ── selectReferees (pure) ─────────────────────────────────

describe("selectReferees", () => {
  test("excludes authors and respects count", () => {
    const picked = selectReferees(["a", "b", "c", "d"], ["b"], 2);
    expect(picked).toHaveLength(2);
    expect(picked).not.toContain("b");
  });

  test("returns fewer when pool is too small", () => {
    expect(selectReferees(["a", "b"], ["a", "b"], 2)).toHaveLength(0);
  });
});

// ── tickSubmitted ─────────────────────────────────────────

describe("tickSubmitted", () => {
  test("transitions submitted paper and assigns 2 pending reviews", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });

    const actions = await tickSubmitted({
      ...CONFIG,
      refereePool: [author.githubLogin, ref1.githubLogin, ref2.githubLogin],
    });

    expect(actions).toEqual([
      expect.objectContaining({ paperId: paper.paperId, action: "under-review" }),
    ]);

    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("under-review");

    const reviews = await prisma.review.findMany({ where: { paperId: paper.id } });
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r) => r.verdict === "pending")).toBe(true);
    // Author never reviews their own paper
    expect(reviews.map((r) => r.reviewerId)).not.toContain(author.id);
  });

  test("insufficient eligible referees → skipped, paper untouched", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });

    const actions = await tickSubmitted({
      ...CONFIG,
      refereePool: [author.githubLogin, ref1.githubLogin], // only 1 eligible
    });

    expect(actions[0].action).toBe("skipped");
    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("submitted");
    expect(await prisma.review.count({ where: { paperId: paper.id } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "editorial.daemon.skipped", entityId: paper.paperId },
    });
    expect(audit).not.toBeNull();
  });

  test("manual-review tag → paper never touched", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });
    await tagManualReview(paper.id);

    const actions = await tickSubmitted({
      ...CONFIG,
      refereePool: [ref1.githubLogin, ref2.githubLogin],
    });

    expect(actions).toHaveLength(0);
    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("submitted");
  });

  test("idempotent: second tick does nothing", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    await createTestPaper(author.id, { status: "submitted" });
    const config = { ...CONFIG, refereePool: [ref1.githubLogin, ref2.githubLogin] };

    await tickSubmitted(config);
    const second = await tickSubmitted(config);
    expect(second).toHaveLength(0);
  });
});

// ── tickUnderReview ───────────────────────────────────────

describe("tickUnderReview", () => {
  async function paperWithVerdicts(v1: string, v2: string) {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });
    const config = { ...CONFIG, refereePool: [ref1.githubLogin, ref2.githubLogin] };
    await tickSubmitted(config);
    await setVerdict(paper.id, ref1.id, v1);
    await setVerdict(paper.id, ref2.id, v2);
    return { paper, config };
  }

  test("waits while verdicts are pending", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });
    const config = { ...CONFIG, refereePool: [ref1.githubLogin, ref2.githubLogin] };
    await tickSubmitted(config);

    const actions = await tickUnderReview(config);
    expect(actions).toHaveLength(0);
    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("under-review");
  });

  test("unanimous accept → accepted, reviews revealed, audit logged", async () => {
    const { paper, config } = await paperWithVerdicts("accept", "accept");

    const actions = await tickUnderReview(config);
    expect(actions).toEqual([
      expect.objectContaining({ paperId: paper.paperId, action: "accepted" }),
    ]);

    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("accepted");

    const reviews = await prisma.review.findMany({ where: { paperId: paper.id } });
    expect(reviews.every((r) => r.visible)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "editorial.decision.auto", entityId: paper.paperId },
    });
    expect(JSON.parse(audit!.details!).decision).toBe("accepted");
  });

  test("unanimous reject → revision", async () => {
    const { paper, config } = await paperWithVerdicts("reject", "reject");

    await tickUnderReview(config);
    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("revision");
  });

  test("mixed verdicts → flagged exactly once, paper stays under-review", async () => {
    const { paper, config } = await paperWithVerdicts("accept", "major-revision");

    const first = await tickUnderReview(config);
    expect(first).toEqual([
      expect.objectContaining({ paperId: paper.paperId, action: "flagged" }),
    ]);

    const second = await tickUnderReview(config);
    expect(second).toHaveLength(0); // already flagged — no duplicate

    const flags = await prisma.auditLog.findMany({
      where: { action: "editorial.decision.flagged", entityId: paper.paperId },
    });
    expect(flags).toHaveLength(1);

    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("under-review");
  });
});

// ── GET /api/reviews/pending ──────────────────────────────

describe("GET /api/reviews/pending", () => {
  test("referee sees their pending assignment with paper context", async () => {
    const author = await createTestUser();
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });
    await tickSubmitted({ ...CONFIG, refereePool: [ref1.githubLogin, ref2.githubLogin] });

    const token = await new SignJWT({ login: ref1.githubLogin, role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(ref1.id))
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(getJwtSecret());

    const res = await pendingReviews(
      new NextRequest("http://localhost:3000/api/reviews/pending", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pending).toHaveLength(1);
    expect(data.pending[0].paperId).toBe(paper.paperId);
    expect(data.pending[0].title).toBeTruthy();
    expect(data.pending[0].abstract).toBeTruthy();
  });

  test("no token → 401", async () => {
    const res = await pendingReviews(
      new NextRequest("http://localhost:3000/api/reviews/pending"),
    );
    expect(res.status).toBe(401);
  });
});
