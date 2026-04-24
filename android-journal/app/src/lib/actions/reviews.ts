"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ok, err, toActionResult } from "@/lib/result";
import { validateReviewData, type ValidatedReviewData } from "@/lib/validation/schemas";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

export type { ValidatedReviewData as ReviewData };

export async function submitReview(
  paperId: string,
  data: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  return withActionTrace("review.submit", async (trace) => {
    const session = await getSession();
    if (!session) { trace.fail("auth", "unauthenticated"); return toActionResult(err("Authentication required")); }
    trace.mark("auth");

    const validated = validateReviewData(data);
    if (validated.isErr()) { trace.fail("validate", validated.error); return toActionResult(validated); }
    trace.mark("validate");
    const review = validated.value;

    const paper = await trace.step("paper-lookup", () =>
      prisma.paper.findUnique({ where: { paperId }, select: { id: true, status: true } }),
    );
    if (!paper) { trace.fail("paper-lookup", "not found"); return toActionResult(err("Paper not found")); }

    if (paper.status !== "under-review") {
      trace.fail("status-check", `status is ${paper.status}`);
      return toActionResult(err("Paper is not under review"));
    }
    trace.mark("status-check");

    const existing = await trace.step("assignment-check", () =>
      prisma.review.findUnique({
        where: { paperId_reviewerId: { paperId: paper.id, reviewerId: session.userId } },
      }),
    );
    if (!existing) { trace.fail("assignment-check", "not assigned"); return toActionResult(err("You have not been assigned to review this paper")); }

    await trace.step("db-update", () =>
      prisma.review.update({
        where: { paperId_reviewerId: { paperId: paper.id, reviewerId: session.userId } },
        data: {
          noveltyScore: review.noveltyScore,
          correctnessScore: review.correctnessScore,
          clarityScore: review.clarityScore,
          significanceScore: review.significanceScore,
          priorWorkScore: review.priorWorkScore,
          summary: review.summary,
          strengths: review.strengths,
          weaknesses: review.weaknesses,
          questions: review.questions,
          connections: review.connections,
          verdict: review.verdict,
          buildOn: review.buildOn,
        },
      }),
    );

    await logAuditEvent({
      action: "review.submitted",
      entity: "review",
      entityId: paperId,
      details: JSON.stringify({ verdict: review.verdict }),
    });
    trace.mark("audit");

    return toActionResult(ok({}));
  });
}
