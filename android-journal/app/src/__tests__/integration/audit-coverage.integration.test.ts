/**
 * Audit Coverage — Log/Test Adjunction Verification
 *
 * CATEGORY THEORY:
 *   Logs (Kleisli arrows for Writer) and tests (co-Kleisli arrows for
 *   a comonad) are adjoint. For each business audit event, this file
 *   verifies both sides of the adjunction:
 *     1. The STATE INVARIANT holds after the event (co-Kleisli: consume
 *        context → produce verdict)
 *     2. The AUDIT ENTRY is correct (Kleisli: the log faithfully records
 *        what happened)
 *
 *   Events without audit entries are tested for intentional absence —
 *   documenting the design decision that they're trace-only.
 *
 *   Gaps found by the audit inventory algorithm:
 *     - user.created: was NOT audited → added audit event
 *     - user.role.changed: was NOT audited → added audit event
 *     - paper.downloaded (CLI): still NOT audited → documented gap
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { toggleFavourite, markAsRead, addNote } from "@/lib/actions/social";
import { submitPaper } from "@/lib/actions/papers";
import { updatePaperStatus, assignReviewer } from "@/lib/actions/editorial";
import { submitReview } from "@/lib/actions/reviews";
import { runCliJson } from "./cli-helpers";
import {
  cleanDatabase,
  createTestUser,
  createTestPaper,
  buildSubmissionForm,
} from "./helpers";

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/** Find audit entries by action, most recent first. */
async function findAuditEntries(action: string) {
  return prisma.auditLog.findMany({
    where: { action },
    orderBy: { timestamp: "desc" },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
//  B1: user.created — NEW audit event
// ═══════════════════════════════════════════════════════════

describe("user.created audit event", () => {
  test("user creation produces audit entry with correct details", async () => {
    // Act: create user via CLI
    const { data } = await runCliJson<{ id: number; githubLogin: string; role: string }>(
      "user", "create",
      "--login", "audit-test-user",
      "--name", "Audit Test User",
      "--type", "human",
      "--role", "user",
    );

    // State invariant: user exists with correct fields
    const user = await prisma.user.findUnique({
      where: { githubLogin: "audit-test-user" },
    });
    expect(user).toBeTruthy();
    expect(user!.displayName).toBe("Audit Test User");
    expect(user!.authorType).toBe("human");
    expect(user!.role).toBe("user");

    // Audit correctness: entry exists with right details
    const audits = await findAuditEntries("user.created");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const entry = audits[0];
    expect(entry.entity).toBe("user");
    expect(entry.entityId).toBe(String(data.id));

    const details = JSON.parse(entry.details!);
    expect(details.githubLogin).toBe("audit-test-user");
    expect(details.role).toBe("user");
    expect(details.authorType).toBe("human");
  });

  test("user creation with editor role records role in audit", async () => {
    await runCliJson(
      "user", "create",
      "--login", "audit-editor",
      "--name", "Audit Editor",
      "--type", "autonomous",
      "--role", "editor",
    );

    const audits = await findAuditEntries("user.created");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.role).toBe("editor");
    expect(details.authorType).toBe("autonomous");
  });
});

// ═══════════════════════════════════════════════════════════
//  B2: user.role.changed — NEW audit event
// ═══════════════════════════════════════════════════════════

describe("user.role.changed audit event", () => {
  test("promotion produces audit entry with from/to roles", async () => {
    // Setup: create a regular user
    await runCliJson(
      "user", "create",
      "--login", "promo-user",
      "--name", "Promo User",
      "--type", "human",
    );

    // Act: promote to editor
    await runCliJson("user", "promote", "promo-user", "--role", "editor");

    // State invariant: role changed in DB
    const user = await prisma.user.findUnique({
      where: { githubLogin: "promo-user" },
    });
    expect(user!.role).toBe("editor");

    // Audit correctness: entry records from/to
    const audits = await findAuditEntries("user.role.changed");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.githubLogin).toBe("promo-user");
    expect(details.from).toBe("user");
    expect(details.to).toBe("editor");
  });

  test("demotion produces separate audit entry", async () => {
    // Setup: create editor
    await runCliJson(
      "user", "create",
      "--login", "demote-user",
      "--name", "Demote User",
      "--type", "human",
      "--role", "editor",
    );

    // Act: demote to user
    await runCliJson("user", "promote", "demote-user", "--role", "user");

    // Audit correctness: records editor → user
    const audits = await findAuditEntries("user.role.changed");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.from).toBe("editor");
    expect(details.to).toBe("user");
  });

  test("promotion then demotion produces two audit entries", async () => {
    await runCliJson(
      "user", "create",
      "--login", "flip-user",
      "--name", "Flip User",
      "--type", "human",
    );

    await runCliJson("user", "promote", "flip-user", "--role", "editor");
    await runCliJson("user", "promote", "flip-user", "--role", "user");

    // Two role.changed entries
    const audits = await findAuditEntries("user.role.changed");
    expect(audits).toHaveLength(2);

    // Most recent first (desc order): user←editor, then editor←user
    const recent = JSON.parse(audits[0].details!);
    const older = JSON.parse(audits[1].details!);
    expect(recent.from).toBe("editor");
    expect(recent.to).toBe("user");
    expect(older.from).toBe("user");
    expect(older.to).toBe("editor");
  });
});

// ═══════════════════════════════════════════════════════════
//  B3: Existing audit events — verify correctness
// ═══════════════════════════════════════════════════════════

describe("existing audit events — adjoint verification", () => {
  test("paper.submitted audit entry matches DB state", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await submitPaper(buildSubmissionForm());
    expect(result.success).toBe(true);

    // State invariant
    const paper = await prisma.paper.findUnique({
      where: { paperId: result.paperId! },
    });
    expect(paper!.status).toBe("submitted");

    // Audit correctness
    const audits = await findAuditEntries("paper.submitted");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].entityId).toBe(result.paperId);
  });

  test("review.assigned audit entry includes reviewer", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser({ githubLogin: "aud-reviewer" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await assignReviewer(paper.paperId, "aud-reviewer");

    const audits = await findAuditEntries("review.assigned");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.reviewer).toBe("aud-reviewer");
  });

  test("paper.transitioned audit entry includes from/to states", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await updatePaperStatus(paper.paperId, "under-review");

    const audits = await findAuditEntries("paper.transitioned");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.from).toBe("submitted");
    expect(details.to).toBe("under-review");
  });
});

// ═══════════════════════════════════════════════════════════
//  B3b: reviews.revealed — NEW audit event (adjoint of invariant test)
// ═══════════════════════════════════════════════════════════

describe("reviews.revealed audit event", () => {
  test("acceptance with completed reviews fires reviews.revealed", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    // Add a completed review
    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: reviewer.id,
        noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
        significanceScore: 4, priorWorkScore: 4,
        summary: "Good", strengths: "Strong", weaknesses: "Minor",
        questions: "", connections: "",
        verdict: "accept",
        visible: false,
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await updatePaperStatus(paper.paperId, "accepted");

    // Audit correctness: reviews.revealed fired with count + totals
    const audits = await findAuditEntries("reviews.revealed");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.count).toBe(1);
    expect(details.total).toBe(1);
    expect(details.pending).toBe(0);
    expect(details.trigger).toBe("accepted");
    expect(audits[0].entityId).toBe(paper.paperId);
  });

  test("acceptance with no completed reviews does NOT fire reviews.revealed", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    // Only a pending review — should not be revealed
    const pendingReviewer = await createTestUser();
    await prisma.review.create({
      data: {
        paperId: paper.id,
        reviewerId: pendingReviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "",
        verdict: "pending",
        visible: false,
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await updatePaperStatus(paper.paperId, "accepted");

    // No reviews.revealed event — count was 0
    const audits = await findAuditEntries("reviews.revealed");
    expect(audits).toHaveLength(0);
  });

  test("multiple revision cycles: reveals all accumulated reviews", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    // Round 1: one reviewer
    const rev1 = await createTestUser();
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: rev1.id,
        noveltyScore: 3, correctnessScore: 3, clarityScore: 3,
        significanceScore: 3, priorWorkScore: 3,
        summary: "Needs work", strengths: "OK", weaknesses: "Gaps",
        questions: "", connections: "",
        verdict: "major-revision", visible: false,
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    // Revision cycle
    await updatePaperStatus(paper.paperId, "revision");
    await updatePaperStatus(paper.paperId, "under-review");

    // Round 2: second reviewer
    const rev2 = await createTestUser();
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: rev2.id,
        noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
        significanceScore: 4, priorWorkScore: 4,
        summary: "Better", strengths: "Strong", weaknesses: "Minor",
        questions: "", connections: "",
        verdict: "accept", visible: false,
      },
    });

    // Accept — both rounds revealed
    await updatePaperStatus(paper.paperId, "accepted");

    const audits = await findAuditEntries("reviews.revealed");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.count).toBe(2);
    expect(details.trigger).toBe("accepted");
  });
});

// ═══════════════════════════════════════════════════════════
//  B3c: paper.published — NEW audit event (adjoint of publishedAt invariant)
// ═══════════════════════════════════════════════════════════

describe("paper.published audit event", () => {
  test("publish fires paper.published with timestamp", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "accepted" });

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const before = new Date();
    await updatePaperStatus(paper.paperId, "published");
    const after = new Date();

    // State invariant: publishedAt is set
    const published = await prisma.paper.findUnique({
      where: { paperId: paper.paperId },
    });
    expect(published!.publishedAt).toBeTruthy();

    // Audit correctness: paper.published event with timestamp
    const audits = await findAuditEntries("paper.published");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    const loggedAt = new Date(details.publishedAt);
    expect(loggedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(loggedAt.getTime()).toBeLessThanOrEqual(after.getTime());

    // The logged timestamp matches the DB value
    expect(loggedAt.toISOString()).toBe(published!.publishedAt!.toISOString());
  });

  test("non-publish transitions do NOT fire paper.published", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await updatePaperStatus(paper.paperId, "under-review");

    const audits = await findAuditEntries("paper.published");
    expect(audits).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  B3d: transition.rejected — NEW audit event (adjoint of invalid transition test)
// ═══════════════════════════════════════════════════════════

describe("transition.rejected audit event", () => {
  test("invalid transition fires transition.rejected", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id); // status = submitted

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    // submitted → published is invalid
    await updatePaperStatus(paper.paperId, "published");

    const audits = await findAuditEntries("transition.rejected");
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const details = JSON.parse(audits[0].details!);
    expect(details.from).toBe("submitted");
    expect(details.attempted).toBe("published");
    expect(audits[0].entityId).toBe(paper.paperId);
  });

  test("valid transition does NOT fire transition.rejected", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const paper = await createTestPaper(author.id);

    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    await updatePaperStatus(paper.paperId, "under-review");

    const audits = await findAuditEntries("transition.rejected");
    expect(audits).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  B4: Intentional non-audit — trace-only events
// ═══════════════════════════════════════════════════════════

describe("intentional non-audit events (trace-only)", () => {
  test("toggleFavourite has no business audit event", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await toggleFavourite(paper.paperId);

    // State invariant: favourite exists
    const fav = await prisma.favourite.findFirst({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(fav).toBeTruthy();

    // No business audit event — only trace
    const businessAudits = await findAuditEntries("favourite.toggled");
    expect(businessAudits).toHaveLength(0);
  });

  test("markAsRead has no business audit event", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await markAsRead(paper.paperId);

    // State invariant: download record exists with read=true
    const dl = await prisma.download.findFirst({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(dl).toBeTruthy();
    expect(dl!.read).toBe(true);

    // No business audit event — only trace
    const businessAudits = await findAuditEntries("read.marked");
    expect(businessAudits).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  B5: validation.failed — NEW audit event (adjoint of validation tests)
// ═══════════════════════════════════════════════════════════

describe("validation.failed audit event", () => {
  test("paper submission with empty title fires validation.failed", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await submitPaper(buildSubmissionForm({ title: "" }));

    const audits = await findAuditEntries("validation.failed");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].entity).toBe("paper");
  });

  test("valid submission does NOT fire validation.failed", async () => {
    const user = await createTestUser();
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await submitPaper(buildSubmissionForm());

    const audits = await findAuditEntries("validation.failed");
    expect(audits).toHaveLength(0);
  });

  test("review with invalid score fires validation.failed", async () => {
    const editor = await createTestUser({ role: "editor" });
    const author = await createTestUser();
    const reviewer = await createTestUser();
    const paper = await createTestPaper(author.id, { status: "under-review" });

    // Assign reviewer
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: reviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "",
        verdict: "pending", visible: false,
      },
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: reviewer.id,
      githubLogin: reviewer.githubLogin,
      role: "user",
    });

    await submitReview(paper.paperId, {
      noveltyScore: 99, // invalid
      correctnessScore: 4,
      clarityScore: 4,
      significanceScore: 4,
      priorWorkScore: 4,
      summary: "Good",
      strengths: "Strong",
      weaknesses: "Minor",
      verdict: "accept",
    });

    const audits = await findAuditEntries("validation.failed");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].entity).toBe("review");
  });

  test("note with empty content fires validation.failed", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await addNote(paper.paperId, "");

    const audits = await findAuditEntries("validation.failed");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].entity).toBe("note");
  });
});

// ═══════════════════════════════════════════════════════════
//  B6: Documented gaps
// ═══════════════════════════════════════════════════════════

describe("documented audit gaps", () => {
  test.todo("paper.downloaded (CLI) — no audit event in CLI download command");
  test.todo("auth.token.invalid — testable via unit tests (auth-session.test.ts), not integration");
});
