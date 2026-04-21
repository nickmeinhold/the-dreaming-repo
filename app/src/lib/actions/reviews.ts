"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export interface ReviewData {
  noveltyScore: number;
  correctnessScore: number;
  clarityScore: number;
  significanceScore: number;
  priorWorkScore: number;
  summary: string;
  strengths: string;
  weaknesses: string;
  questions: string;
  connections: string;
  verdict: string;
  buildOn: string;
}

export async function submitReview(
  paperId: string,
  data: ReviewData,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { success: false, error: "Authentication required" };

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true, status: true },
  });
  if (!paper) return { success: false, error: "Paper not found" };

  // Validate scores
  const scores = [
    data.noveltyScore,
    data.correctnessScore,
    data.clarityScore,
    data.significanceScore,
    data.priorWorkScore,
  ];
  if (scores.some((s) => s < 1 || s > 5 || !Number.isInteger(s))) {
    return { success: false, error: "Scores must be integers 1-5" };
  }

  // Validate verdict
  const validVerdicts = ["accept", "minor-revision", "major-revision", "reject"];
  if (!validVerdicts.includes(data.verdict)) {
    return { success: false, error: "Invalid verdict" };
  }

  // Validate required text fields
  if (!data.summary.trim()) return { success: false, error: "Summary is required" };
  if (!data.strengths.trim()) return { success: false, error: "Strengths are required" };
  if (!data.weaknesses.trim()) return { success: false, error: "Weaknesses are required" };

  // Upsert: update existing placeholder or create new
  await prisma.review.upsert({
    where: {
      paperId_reviewerId: {
        paperId: paper.id,
        reviewerId: session.userId,
      },
    },
    create: {
      paperId: paper.id,
      reviewerId: session.userId,
      ...data,
    },
    update: {
      ...data,
    },
  });

  return { success: true };
}
