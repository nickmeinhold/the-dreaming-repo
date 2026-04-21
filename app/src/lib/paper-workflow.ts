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
  "under-review": ["revision", "accepted", "published"],
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
  const paper = await prisma.paper.findUnique({
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

  await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = { status: newStatus };

    if (newStatus === "published") {
      data.publishedAt = new Date();
    }

    await tx.paper.update({
      where: { paperId },
      data,
    });

    // Make reviews visible on acceptance or publication
    if (newStatus === "accepted" || newStatus === "published") {
      await tx.review.updateMany({
        where: { paperId: paper.id },
        data: { visible: true },
      });
    }
  });

  return { success: true };
}
