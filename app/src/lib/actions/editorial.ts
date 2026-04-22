"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { transitionPaper } from "@/lib/paper-workflow";

const EDITOR_ROLES = ["editor", "admin"];

export async function updatePaperStatus(
  paperId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !EDITOR_ROLES.includes(session.role)) {
    return { success: false, error: "Editor role required" };
  }

  const result = await transitionPaper(prisma, paperId, newStatus);
  if (result.success) {
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/papers");
  }
  return result;
}

export async function assignReviewer(
  paperId: string,
  githubLogin: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !EDITOR_ROLES.includes(session.role)) {
    return { success: false, error: "Editor role required" };
  }

  const user = await prisma.user.findUnique({
    where: { githubLogin },
    select: { id: true },
  });
  if (!user) return { success: false, error: "User not found" };

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: {
      id: true,
      authors: { select: { userId: true } },
    },
  });
  if (!paper) return { success: false, error: "Paper not found" };

  // Prevent self-review: reviewer must not be an author
  if (paper.authors.some((a) => a.userId === user.id)) {
    return { success: false, error: "An author cannot review their own paper" };
  }

  // Check for existing review
  const existing = await prisma.review.findUnique({
    where: { paperId_reviewerId: { paperId: paper.id, reviewerId: user.id } },
  });
  if (existing) return { success: false, error: "Already assigned" };

  // Create a placeholder review (reviewer fills in later)
  await prisma.review.create({
    data: {
      paperId: paper.id,
      reviewerId: user.id,
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
    },
  });

  return { success: true };
}
