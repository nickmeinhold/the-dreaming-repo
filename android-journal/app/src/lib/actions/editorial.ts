"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { transitionPaper } from "@/lib/paper-workflow";
import { ok, err, toActionResult, type Result } from "@/lib/result";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace, type TraceRecorder } from "@/lib/trace";

async function requireEditor(trace: TraceRecorder): Promise<Result<{ userId: number }>> {
  const session = await getSession();
  if (!session || !EDITOR_ROLES.includes(session.role)) {
    trace.fail("auth-editor", "not editor");
    return err("Editor role required");
  }

  // Fresh DB check — JWT role may be stale if user was demoted
  const freshUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });
  if (!freshUser || !EDITOR_ROLES.includes(freshUser.role)) {
    trace.fail("auth-editor", "demoted");
    return err("Insufficient permissions");
  }

  trace.mark("auth-editor");
  return ok({ userId: session.userId });
}

export async function updatePaperStatus(
  paperId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  return withActionTrace("paper.transition", async (trace) => {
    const editor = await requireEditor(trace);
    if (editor.isErr()) return toActionResult(editor);

    return trace.step("transition", () => transitionPaper(prisma, paperId, newStatus));
  });
}

export async function assignReviewer(
  paperId: string,
  githubLogin: string,
): Promise<{ success: boolean; error?: string }> {
  return withActionTrace("reviewer.assign", async (trace) => {
    const editor = await requireEditor(trace);
    if (editor.isErr()) return toActionResult(editor);

    const user = await trace.step("user-lookup", () =>
      prisma.user.findUnique({ where: { githubLogin }, select: { id: true } }),
    );
    if (!user) { trace.fail("user-lookup", "not found"); return toActionResult(err("User not found")); }

    const paper = await trace.step("paper-lookup", () =>
      prisma.paper.findUnique({ where: { paperId }, select: { id: true, status: true } }),
    );
    if (!paper) { trace.fail("paper-lookup", "not found"); return toActionResult(err("Paper not found")); }

    if (paper.status !== "under-review") {
      trace.fail("status-check", `status is ${paper.status}`);
      return toActionResult(err("Paper must be under review to assign reviewers"));
    }
    trace.mark("status-check");

    const isAuthor = await trace.step("author-check", () =>
      prisma.paperAuthor.findUnique({
        where: { paperId_userId: { paperId: paper.id, userId: user.id } },
      }),
    );
    if (isAuthor) { trace.fail("author-check", "is author"); return toActionResult(err("Cannot assign a paper's author as reviewer")); }

    const existing = await trace.step("dup-check", () =>
      prisma.review.findUnique({
        where: { paperId_reviewerId: { paperId: paper.id, reviewerId: user.id } },
      }),
    );
    if (existing) { trace.fail("dup-check", "already assigned"); return toActionResult(err("Already assigned")); }

    await trace.step("db-create", () =>
      prisma.review.create({
        data: {
          paperId: paper.id,
          reviewerId: user.id,
          noveltyScore: 0, correctnessScore: 0, clarityScore: 0,
          significanceScore: 0, priorWorkScore: 0,
          summary: "", strengths: "", weaknesses: "",
          questions: "", connections: "",
          verdict: "pending",
        },
      }),
    );

    await logAuditEvent({
      action: "review.assigned",
      entity: "review",
      entityId: paperId,
      details: JSON.stringify({ reviewer: githubLogin }),
    });
    trace.mark("audit");

    return toActionResult(ok({}));
  });
}
