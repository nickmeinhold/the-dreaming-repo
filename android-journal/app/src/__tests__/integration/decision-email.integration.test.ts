/**
 * Decision Email Integration Tests (Plan 4)
 *
 * The paper.decision → email pipeline in stub mode (no RESEND_API_KEY):
 * a decision (daemon or manual transitionPaper) triggers the subscriber,
 * which sends to authors with email + notifications on, and audit-logs
 * email.sent / email.skipped per author. Email never blocks decisions.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

process.env.JWT_SECRET =
  "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";
delete process.env.RESEND_API_KEY; // force stub mode

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => ({ get: vi.fn(() => null) })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { transitionPaper } from "@/lib/paper-workflow";
import { tickSubmitted, tickUnderReview } from "@/lib/editorial/daemon";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

const CONFIG = { refereePool: [] as string[], refereesPerPaper: 2 };

async function setVerdict(paperDbId: number, reviewerId: number, verdict: string) {
  await prisma.review.update({
    where: { paperId_reviewerId: { paperId: paperDbId, reviewerId } },
    data: { verdict, noveltyScore: 3, correctnessScore: 3, clarityScore: 3, significanceScore: 3, priorWorkScore: 3 },
  });
}

async function emailAudits(paperId: string) {
  return prisma.auditLog.findMany({
    where: { action: { startsWith: "email." }, entityId: paperId },
    orderBy: { id: "asc" },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

describe("decision emails (stub mode)", () => {
  test("daemon decision → email.sent (stubbed) for author with email", async () => {
    const author = await createTestUser();
    await prisma.user.update({
      where: { id: author.id },
      data: { email: "author@example.com" },
    });
    const ref1 = await createTestUser();
    const ref2 = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "submitted" });
    const config = { ...CONFIG, refereePool: [ref1.githubLogin, ref2.githubLogin] };

    await tickSubmitted(config);
    await setVerdict(paper.id, ref1.id, "accept");
    await setVerdict(paper.id, ref2.id, "accept");
    await tickUnderReview(config);

    const audits = await emailAudits(paper.paperId);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("email.sent");
    const details = JSON.parse(audits[0].details!);
    expect(details.author).toBe(author.githubLogin);
    expect(details.decision).toBe("accepted");
    expect(details.mode).toBe("stubbed");
  });

  test("author without email → email.skipped, decision unaffected", async () => {
    const author = await createTestUser(); // no email
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const result = await transitionPaper(prisma, paper.paperId, "revision");
    expect(result.success).toBe(true);

    const audits = await emailAudits(paper.paperId);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("email.skipped");
    expect(JSON.parse(audits[0].details!).reason).toBe("no email on file");

    const updated = await prisma.paper.findUnique({ where: { id: paper.id } });
    expect(updated!.status).toBe("revision");
  });

  test("notifications off → email.skipped", async () => {
    const author = await createTestUser();
    await prisma.user.update({
      where: { id: author.id },
      data: { email: "author@example.com", emailNotifications: false },
    });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    await transitionPaper(prisma, paper.paperId, "revision");

    const audits = await emailAudits(paper.paperId);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("email.skipped");
    expect(JSON.parse(audits[0].details!).reason).toBe("notifications disabled");
  });

  test("multiple authors → one audit row each", async () => {
    const a1 = await createTestUser();
    const a2 = await createTestUser();
    await prisma.user.update({
      where: { id: a1.id },
      data: { email: "a1@example.com" },
    });
    const paper = await createTestPaper(a1.id, { status: "under-review" });
    await prisma.paperAuthor.create({
      data: { paperId: paper.id, userId: a2.id, order: 2 },
    });

    await transitionPaper(prisma, paper.paperId, "accepted");

    const audits = await emailAudits(paper.paperId);
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.action).sort()).toEqual(["email.sent", "email.skipped"]);
  });

  test("non-decision transitions emit nothing", async () => {
    const author = await createTestUser();
    await prisma.user.update({
      where: { id: author.id },
      data: { email: "author@example.com" },
    });
    const paper = await createTestPaper(author.id, { status: "accepted" });

    await transitionPaper(prisma, paper.paperId, "published");

    expect(await emailAudits(paper.paperId)).toHaveLength(0);
  });
});
