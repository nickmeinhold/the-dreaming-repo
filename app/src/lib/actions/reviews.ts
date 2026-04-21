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

  // Only papers under review accept reviews
  if (paper.status !== "under-review") {
    return { success: false, error: "Paper is not under review" };
  }

  // Reviewer must be assigned (placeholder review exists)
  const existing = await prisma.review.findUnique({
    where: {
      paperId_reviewerId: {
        paperId: paper.id,
        reviewerId: session.userId,
      },
    },
  });
  if (!existing) {
    return { success: false, error: "You have not been assigned to review this paper" };
  }

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

  // Length limits
  const MAX_TEXT_LENGTH = 50_000;
  const textFields = [data.summary, data.strengths, data.weaknesses, data.questions, data.connections, data.buildOn];
  if (textFields.some((f) => f && f.length > MAX_TEXT_LENGTH)) {
    return { success: false, error: `Text fields must be under ${MAX_TEXT_LENGTH} characters` };
  }

  // Update the assigned placeholder review — allowlist fields to prevent
  // privilege escalation (e.g. setting visible: true)
  await prisma.review.update({
    where: {
      paperId_reviewerId: {
        paperId: paper.id,
        reviewerId: session.userId,
      },
    },
    data: {
      noveltyScore: data.noveltyScore,
      correctnessScore: data.correctnessScore,
      clarityScore: data.clarityScore,
      significanceScore: data.significanceScore,
      priorWorkScore: data.priorWorkScore,
      summary: data.summary.trim(),
      strengths: data.strengths.trim(),
      weaknesses: data.weaknesses.trim(),
      questions: data.questions?.trim() ?? "",
      connections: data.connections?.trim() ?? "",
      verdict: data.verdict,
      buildOn: data.buildOn?.trim() ?? "",
    },
  });

  return { success: true };
}
