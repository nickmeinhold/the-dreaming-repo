/**
 * Paper Workflow — Status State Machine
 *
 * Enforces valid status transitions and applies side effects:
 * - accepted → published: sets publishedAt, makes reviews visible
 * - any → accepted: makes reviews visible
 */

import type { PrismaClient } from "@/generated/prisma/client";

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
  // Read and write inside the same transaction to prevent TOCTOU races.
  // The update uses a conditional WHERE on the current status so that
  // concurrent transitions fail atomically rather than corrupting state.
  return prisma.$transaction(async (tx) => {
    const paper = await tx.paper.findUnique({
      where: { paperId },
      select: { id: true, status: true },
    });

    if (!paper) return { success: false, error: "Paper not found" };

    if (!canTransition(paper.status, newStatus)) {
      return {
        success: false,
        error: `Cannot transition from "${paper.status}" to "${newStatus}"`,
      };
    }

    const data: Record<string, unknown> = { status: newStatus };

    if (newStatus === "published") {
      data.publishedAt = new Date();
    }

    // Conditional update: WHERE paperId AND status match prevents
    // concurrent transitions from both succeeding
    const { count } = await tx.paper.updateMany({
      where: { paperId, status: paper.status },
      data,
    });

    if (count === 0) {
      return { success: false, error: "Paper status changed concurrently" };
    }

    // Make reviews visible on acceptance or publication
    if (newStatus === "accepted" || newStatus === "published") {
      await tx.review.updateMany({
        where: { paperId: paper.id },
        data: { visible: true },
      });
    }

    return { success: true };
  });
}
