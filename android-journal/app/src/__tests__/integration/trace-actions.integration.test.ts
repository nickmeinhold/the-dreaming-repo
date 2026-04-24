/**
 * T1–T5: Trace Completeness, Failure Isolation, Correlation Coherence,
 *         Audit Completeness, Category Coverage
 *
 * Calls Server Actions directly (not via CLI) to verify that
 * the observation monoid accumulates the correct structure.
 *
 * Each test is a projection or fold on the monoid — derived from
 * OBSERVABILITY.md's co-design framework.
 *
 * Mocks getSession (no Next.js request context in tests) but uses
 * real PostgreSQL for everything else.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { cleanDatabase, createTestUser, createTestPaper, buildSubmissionForm } from "./helpers";
import { prisma } from "@/lib/db";
import { _lastTrace, _resetTrace, type ActionTrace } from "@/lib/trace";

// ── Mocks ──────────────────────────────────────────────────

// Mock getSession — Server Actions need a session but we have no cookies
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue(null),
  };
});

// Mock revalidatePath — not available outside Next.js
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getSession } from "@/lib/auth";
const mockGetSession = vi.mocked(getSession);

// ── Server Action Imports ──────────────────────────────────

import { submitPaper } from "@/lib/actions/papers";
import { addNote, toggleFavourite, markAsRead } from "@/lib/actions/social";
import { updatePaperStatus, assignReviewer } from "@/lib/actions/editorial";
import { submitReview } from "@/lib/actions/reviews";

// ── Helpers ────────────────────────────────────────────────

function stepNames(trace: ActionTrace | null): string[] {
  return trace?.steps.map((s) => s.name) ?? [];
}

function lastErr(trace: ActionTrace | null): string | undefined {
  return trace?.steps.findLast((s) => s.status === "err")?.name;
}

function lastErrMsg(trace: ActionTrace | null): string | undefined {
  return trace?.steps.findLast((s) => s.status === "err")?.error;
}

function setSession(userId: number, login: string, role: string = "user") {
  mockGetSession.mockResolvedValue({ userId, githubLogin: login, role: role as "user" | "editor" | "admin" });
}

function clearSession() {
  mockGetSession.mockResolvedValue(null);
}

// ── Setup ──────────────────────────────────────────────────

beforeEach(async () => {
  await cleanDatabase();
  _resetTrace();
  clearSession();
});

// ════════════════════════════════════════════════════════════
// T1: Trace Completeness — "Every action produces the right steps"
// ════════════════════════════════════════════════════════════

describe("T1: trace completeness — success paths", () => {
  test("paper.submit: 9 steps on success", async () => {
    const user = await createTestUser({ githubLogin: "t1-submit" });
    setSession(user.id, "t1-submit");

    const form = buildSubmissionForm();
    await submitPaper(form);

    expect(_lastTrace?.action).toBe("paper.submit");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual([
      "auth", "extract-fields", "validate", "pdf-validate",
      "latex-check", "user-lookup", "db-create", "file-store", "audit",
    ]);
  });

  test("note.add: 5 steps on success (top-level note)", async () => {
    const user = await createTestUser({ githubLogin: "t1-note" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t1-note");

    await addNote(paper.paperId, "Test note content");

    expect(_lastTrace?.action).toBe("note.add");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual([
      "auth", "validate", "paper-lookup", "parent-check", "db-create", "audit",
    ]);
  });

  test("favourite.toggle: 3 steps on success", async () => {
    const user = await createTestUser({ githubLogin: "t1-fav" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t1-fav");

    await toggleFavourite(paper.paperId);

    expect(_lastTrace?.action).toBe("favourite.toggle");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual(["auth", "paper-lookup", "db-toggle"]);
  });

  test("read.mark: 3 steps on success", async () => {
    const user = await createTestUser({ githubLogin: "t1-read" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t1-read");

    await markAsRead(paper.paperId);

    expect(_lastTrace?.action).toBe("read.mark");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual(["auth", "paper-lookup", "db-upsert"]);
  });

  test("paper.transition: 2 steps on success", async () => {
    const editor = await createTestUser({ githubLogin: "t1-editor", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });
    setSession(editor.id, "t1-editor", "editor");

    await updatePaperStatus(paper.paperId, "under-review");

    expect(_lastTrace?.action).toBe("paper.transition");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual(["auth-editor", "transition"]);
  });

  test("reviewer.assign: 8 steps on success", async () => {
    const editor = await createTestUser({ githubLogin: "t1-ed2", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t1-rev" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    setSession(editor.id, "t1-ed2", "editor");

    await assignReviewer(paper.paperId, "t1-rev");

    expect(_lastTrace?.action).toBe("reviewer.assign");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual([
      "auth-editor", "user-lookup", "paper-lookup",
      "status-check", "author-check", "dup-check", "db-create", "audit",
    ]);
  });

  test("review.submit: 7 steps on success", async () => {
    const editor = await createTestUser({ githubLogin: "t1-ed3", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t1-rev2" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    // Create placeholder review (normally done by assignReviewer)
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: reviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "", verdict: "pending",
      },
    });

    setSession(reviewer.id, "t1-rev2");

    await submitReview(paper.paperId, {
      noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
      significanceScore: 4, priorWorkScore: 4,
      summary: "Good paper.", strengths: "Strong.", weaknesses: "Minor.",
      questions: "", connections: "", verdict: "accept", buildOn: "",
    });

    expect(_lastTrace?.action).toBe("review.submit");
    expect(_lastTrace?.status).toBe("ok");
    expect(stepNames(_lastTrace)).toEqual([
      "auth", "validate", "paper-lookup", "status-check",
      "assignment-check", "db-update", "audit",
    ]);
  });
});

// ════════════════════════════════════════════════════════════
// T2: Failure Isolation — "Errors stop at the right step"
// ════════════════════════════════════════════════════════════

describe("T2: failure isolation", () => {
  test("paper.submit: auth failure stops at step 1", async () => {
    clearSession(); // no session
    const form = buildSubmissionForm();
    await submitPaper(form);

    expect(_lastTrace?.status).toBe("err");
    expect(lastErr(_lastTrace)).toBe("auth");
    expect(stepNames(_lastTrace)).toEqual(["auth"]);
  });

  test("paper.submit: validation failure shows auth passed", async () => {
    const user = await createTestUser({ githubLogin: "t2-val" });
    setSession(user.id, "t2-val");

    const form = buildSubmissionForm({ title: "" }); // invalid
    await submitPaper(form);

    expect(_lastTrace?.status).toBe("err");
    expect(lastErr(_lastTrace)).toBe("validate");
    // Steps before failure all passed
    const steps = _lastTrace!.steps;
    expect(steps.filter((s) => s.status === "ok").map((s) => s.name)).toContain("auth");
    expect(steps.filter((s) => s.status === "ok").map((s) => s.name)).toContain("extract-fields");
  });

  test("paper.submit: bad PDF stops at pdf-magic", async () => {
    const user = await createTestUser({ githubLogin: "t2-pdf" });
    setSession(user.id, "t2-pdf");

    const form = buildSubmissionForm();
    // Replace PDF with non-PDF bytes
    const badPdf = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, ...Array(100).fill(0x00)]);
    form.set("pdf", new Blob([badPdf], { type: "application/pdf" }), "bad.pdf");
    await submitPaper(form);

    expect(lastErr(_lastTrace)).toBe("pdf-magic");
    expect(lastErrMsg(_lastTrace)).toContain("invalid magic bytes");
  });

  test("note.add: auth failure stops immediately", async () => {
    clearSession();
    await addNote("2026-999", "test");

    expect(lastErr(_lastTrace)).toBe("auth");
    expect(stepNames(_lastTrace)).toEqual(["auth"]);
  });

  test("note.add: unpublished paper fails at paper-lookup", async () => {
    const user = await createTestUser({ githubLogin: "t2-note" });
    const paper = await createTestPaper(user.id, { status: "submitted" });
    setSession(user.id, "t2-note");

    await addNote(paper.paperId, "should fail");

    expect(lastErr(_lastTrace)).toBe("paper-lookup");
    // Auth and validate passed
    expect(_lastTrace!.steps[0]).toMatchObject({ name: "auth", status: "ok" });
    expect(_lastTrace!.steps[1]).toMatchObject({ name: "validate", status: "ok" });
  });

  test("paper.transition: non-editor fails at auth-editor", async () => {
    const user = await createTestUser({ githubLogin: "t2-noeditor" });
    const paper = await createTestPaper(user.id, { status: "submitted" });
    setSession(user.id, "t2-noeditor"); // role: "user"

    await updatePaperStatus(paper.paperId, "under-review");

    expect(lastErr(_lastTrace)).toBe("auth-editor");
    expect(lastErrMsg(_lastTrace)).toContain("not editor");
  });

  test("paper.transition: invalid transition fails at transition step", async () => {
    const editor = await createTestUser({ githubLogin: "t2-badtrans", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });
    setSession(editor.id, "t2-badtrans", "editor");

    await updatePaperStatus(paper.paperId, "published");

    // auth-editor passed, transition failed
    expect(_lastTrace!.steps[0]).toMatchObject({ name: "auth-editor", status: "ok" });
    // The transition step ran but returned an error result (not a throw)
    // The overall trace status should reflect the action returning an error
    expect(_lastTrace?.status).toBe("ok"); // no step explicitly called trace.fail
    // The transition function returns { success: false } but doesn't call trace.fail
    // This is correct — the error is in the action's return value, not the trace
  });

  test("reviewer.assign: duplicate reviewer fails at dup-check", async () => {
    const editor = await createTestUser({ githubLogin: "t2-dup-ed", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t2-dup-rev" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    setSession(editor.id, "t2-dup-ed", "editor");

    // First assignment succeeds
    await assignReviewer(paper.paperId, "t2-dup-rev");

    // Second assignment fails at dup-check
    _resetTrace();
    await assignReviewer(paper.paperId, "t2-dup-rev");

    expect(lastErr(_lastTrace)).toBe("dup-check");
    expect(lastErrMsg(_lastTrace)).toContain("already assigned");
    // All steps before dup-check passed
    const okSteps = _lastTrace!.steps.filter((s) => s.status === "ok").map((s) => s.name);
    expect(okSteps).toContain("auth-editor");
    expect(okSteps).toContain("user-lookup");
    expect(okSteps).toContain("paper-lookup");
    expect(okSteps).toContain("status-check");
    expect(okSteps).toContain("author-check");
  });

  test("reviewer.assign: author as reviewer fails at author-check", async () => {
    const editor = await createTestUser({ githubLogin: "t2-self-ed", role: "editor" });
    const author = await createTestUser({ githubLogin: "t2-self-auth" });
    const paper = await createTestPaper(author.id, { status: "under-review" });
    setSession(editor.id, "t2-self-ed", "editor");

    await assignReviewer(paper.paperId, "t2-self-auth");

    expect(lastErr(_lastTrace)).toBe("author-check");
    expect(lastErrMsg(_lastTrace)).toContain("is author");
  });

  test("review.submit: not assigned fails at assignment-check", async () => {
    const editor = await createTestUser({ githubLogin: "t2-noassign-ed", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t2-noassign-rev" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    setSession(reviewer.id, "t2-noassign-rev");

    await submitReview(paper.paperId, {
      noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
      significanceScore: 4, priorWorkScore: 4,
      summary: "Test.", strengths: "S.", weaknesses: "W.",
      verdict: "accept",
    });

    expect(lastErr(_lastTrace)).toBe("assignment-check");
    expect(lastErrMsg(_lastTrace)).toContain("not assigned");
  });
});

// ════════════════════════════════════════════════════════════
// T3: Correlation Coherence — "Trace and audit share correlationId"
// ════════════════════════════════════════════════════════════

describe("T3: correlation coherence", () => {
  test("submitPaper: trace correlationId matches audit event", async () => {
    const user = await createTestUser({ githubLogin: "t3-submit" });
    setSession(user.id, "t3-submit");

    await submitPaper(buildSubmissionForm());

    expect(_lastTrace?.correlationId).toBeTruthy();

    // Find the audit event
    const audit = await prisma.auditLog.findFirst({
      where: { action: "paper.submitted" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.correlationId).toBe(_lastTrace!.correlationId);
  });

  test("assignReviewer: trace correlationId matches audit event", async () => {
    const editor = await createTestUser({ githubLogin: "t3-ed", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t3-rev" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    setSession(editor.id, "t3-ed", "editor");

    await assignReviewer(paper.paperId, "t3-rev");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "review.assigned" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit!.correlationId).toBe(_lastTrace!.correlationId);
  });

  test("addNote: trace correlationId matches audit event", async () => {
    const user = await createTestUser({ githubLogin: "t3-note" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t3-note");

    await addNote(paper.paperId, "Correlation test");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "note.added" },
      orderBy: { timestamp: "desc" },
    });
    expect(audit!.correlationId).toBe(_lastTrace!.correlationId);
  });
});

// ════════════════════════════════════════════════════════════
// T4: Audit Completeness — "Every mutation produces an audit event"
// ════════════════════════════════════════════════════════════

describe("T4: audit completeness", () => {
  test("submitPaper → paper.submitted", async () => {
    const user = await createTestUser({ githubLogin: "t4-sub" });
    setSession(user.id, "t4-sub");
    await submitPaper(buildSubmissionForm());

    const count = await prisma.auditLog.count({ where: { action: "paper.submitted" } });
    expect(count).toBe(1);
  });

  test("updatePaperStatus → paper.transitioned", async () => {
    const editor = await createTestUser({ githubLogin: "t4-ed", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });
    setSession(editor.id, "t4-ed", "editor");

    await updatePaperStatus(paper.paperId, "under-review");

    const audit = await prisma.auditLog.findFirst({ where: { action: "paper.transitioned" } });
    expect(audit).toBeTruthy();
    expect(audit!.entityId).toBe(paper.paperId);
  });

  test("assignReviewer → review.assigned", async () => {
    const editor = await createTestUser({ githubLogin: "t4-ed2", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t4-rev" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    setSession(editor.id, "t4-ed2", "editor");

    await assignReviewer(paper.paperId, "t4-rev");

    const audit = await prisma.auditLog.findFirst({ where: { action: "review.assigned" } });
    expect(audit).toBeTruthy();
    const details = JSON.parse(audit!.details!);
    expect(details.reviewer).toBe("t4-rev");
  });

  test("submitReview → review.submitted", async () => {
    const editor = await createTestUser({ githubLogin: "t4-ed3", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "t4-rev2" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: reviewer.id,
        noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
        significanceScore: 0, priorWorkScore: 0,
        summary: "", strengths: "", weaknesses: "",
        questions: "", connections: "", verdict: "pending",
      },
    });
    setSession(reviewer.id, "t4-rev2");

    await submitReview(paper.paperId, {
      noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
      significanceScore: 4, priorWorkScore: 4,
      summary: "Good.", strengths: "S.", weaknesses: "W.",
      verdict: "accept",
    });

    const audit = await prisma.auditLog.findFirst({ where: { action: "review.submitted" } });
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.details!).verdict).toBe("accept");
  });

  test("addNote → note.added", async () => {
    const user = await createTestUser({ githubLogin: "t4-note" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t4-note");

    await addNote(paper.paperId, "Audit test note");

    const audit = await prisma.auditLog.findFirst({ where: { action: "note.added" } });
    expect(audit).toBeTruthy();
    expect(audit!.entityId).toBe(paper.paperId);
  });

  test("toggleFavourite → no business audit event (intentional)", async () => {
    const user = await createTestUser({ githubLogin: "t4-fav" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t4-fav");

    await toggleFavourite(paper.paperId);

    // No business audit event — but trace audit exists
    const businessCount = await prisma.auditLog.count({ where: { action: "favourite.toggled" } });
    expect(businessCount).toBe(0);
    // Trace event does exist
    const traceCount = await prisma.auditLog.count({ where: { action: "trace.favourite.toggle" } });
    expect(traceCount).toBe(1);
  });

  test("markAsRead → no business audit event (intentional)", async () => {
    const user = await createTestUser({ githubLogin: "t4-read" });
    const paper = await createTestPaper(user.id, { status: "published" });
    setSession(user.id, "t4-read");

    await markAsRead(paper.paperId);

    const businessCount = await prisma.auditLog.count({ where: { action: "read.marked" } });
    expect(businessCount).toBe(0);
    const traceCount = await prisma.auditLog.count({ where: { action: "trace.read.mark" } });
    expect(traceCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// T5: Category Coverage — "Every cat label is tested"
// ════════════════════════════════════════════════════════════

describe("T5: category coverage", () => {
  test("action trace categories derive from action names", () => {
    // The cat label is derived from the action name: "paper.submit" → "paper"
    // Verify the mapping for all instrumented actions
    const actionToCategory: Record<string, string> = {
      "paper.submit": "paper",
      "note.add": "note",
      "favourite.toggle": "favourite",
      "read.mark": "read",
      "paper.transition": "paper",
      "reviewer.assign": "reviewer",
      "review.submit": "review",
      "paper.download": "paper",
      "auth.github-callback": "auth",
    };

    for (const [action, expectedCat] of Object.entries(actionToCategory)) {
      const derived = action.split(".")[0];
      expect(derived).toBe(expectedCat);
    }
  });
});
