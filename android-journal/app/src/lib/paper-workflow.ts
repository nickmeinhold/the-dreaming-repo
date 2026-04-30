/**
 * Paper Workflow — Status State Machine
 *
 * Enforces valid status transitions and applies side effects:
 * - accepted → published: sets publishedAt, makes reviews visible
 * - any → accepted: makes reviews visible
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { ok, err, toActionResult, type Result } from "@/lib/result";
import { logAuditEvent } from "@/lib/audit";

const VALID_TRANSITIONS: Record<string, string[]> = {
  submitted: ["under-review"],
  "under-review": ["revision", "accepted"],
  revision: ["under-review"],
  accepted: ["published"],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validNextStatuses(from: string): string[] {
  return VALID_TRANSITIONS[from] ?? [];
}

export async function transitionPaper(
  prisma: PrismaClient,
  paperId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  let fromStatus: string | undefined;

  const result: Result<Record<string, unknown>> = await prisma.$transaction(async (tx) => {
    const paper = await tx.paper.findUnique({
      where: { paperId },
      select: { id: true, status: true },
    });

    if (!paper) return err("Paper not found");

    fromStatus = paper.status;

    if (!canTransition(paper.status, newStatus)) {
      return err(`Cannot transition from "${paper.status}" to "${newStatus}"`);
    }

    // Optimistic lock: only update if status hasn't changed since we read it
    const data: Record<string, unknown> = { status: newStatus };
    let publishedAt: Date | null = null;
    if (newStatus === "published") {
      publishedAt = new Date();
      data.publishedAt = publishedAt;
    }

    const { count } = await tx.paper.updateMany({
      where: { id: paper.id, status: paper.status },
      data,
    });

    if (count === 0) {
      return err("Paper status changed concurrently, please retry");
    }

    // Make reviews visible on acceptance or publication
    let reviewsRevealed = 0;
    let totalReviews = 0;
    let pendingReviews = 0;
    if (newStatus === "accepted" || newStatus === "published") {
      const { count } = await tx.review.updateMany({
        where: { paperId: paper.id, verdict: { not: "pending" } },
        data: { visible: true },
      });
      reviewsRevealed = count;
      pendingReviews = await tx.review.count({
        where: { paperId: paper.id, verdict: "pending" },
      });
      totalReviews = reviewsRevealed + pendingReviews;
    }

    return ok({ reviewsRevealed, totalReviews, pendingReviews, publishedAt });
  });

  const actionResult = toActionResult(result);

  if (result.isOk() && fromStatus) {
    await logAuditEvent({
      action: "paper.transitioned",
      entity: "paper",
      entityId: paperId,
      details: JSON.stringify({ from: fromStatus, to: newStatus }),
    });

    if (result.value.publishedAt) {
      await logAuditEvent({
        action: "paper.published",
        entity: "paper",
        entityId: paperId,
        details: JSON.stringify({ publishedAt: result.value.publishedAt.toISOString() }),
      });
    }

    if (result.value.reviewsRevealed > 0) {
      await logAuditEvent({
        action: "reviews.revealed",
        entity: "paper",
        entityId: paperId,
        details: JSON.stringify({
          count: result.value.reviewsRevealed,
          pending: result.value.pendingReviews,
          total: result.value.totalReviews,
          trigger: newStatus,
        }),
      });
    }
  }

  if (result.isErr() && result.error.startsWith("Cannot transition")) {
    await logAuditEvent({
      action: "transition.rejected",
      entity: "paper",
      entityId: paperId,
      details: JSON.stringify({ from: fromStatus, attempted: newStatus }),
    });
  }

  return actionResult;
}
