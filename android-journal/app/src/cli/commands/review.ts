/**
 * Review Commands — Submit and view peer reviews
 *
 * submit mirrors the server action: validates all 12 fields via the
 * applicative validator, checks assignment, then updates the
 * placeholder review created by `editorial assign`.
 *
 * show is visibility-gated: editors see all reviews, others see
 * only visible ones (reviews become visible after acceptance).
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { validateReviewData } from "@/lib/validation/schemas";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { CliError, output, resolveUser, withCliTrace } from "@/cli/helpers";

export function registerReviewCommands(program: Command): void {
  const review = program.command("review").description("Peer reviews");

  // ── submit ──────────────────────────────────────────────
  review
    .command("submit <paperId>")
    .description("Submit a peer review (must be assigned)")
    .requiredOption("--novelty <n>", "Novelty score (1-5)")
    .requiredOption("--correctness <n>", "Correctness score (1-5)")
    .requiredOption("--clarity <n>", "Clarity score (1-5)")
    .requiredOption("--significance <n>", "Significance score (1-5)")
    .requiredOption("--prior-work <n>", "Prior work score (1-5)")
    .requiredOption("--verdict <v>", "Verdict: accept | minor-revision | major-revision | reject")
    .requiredOption("--summary <text>", "Review summary")
    .requiredOption("--strengths <text>", "Paper strengths")
    .requiredOption("--weaknesses <text>", "Paper weaknesses")
    .option("--questions <text>", "Questions for authors", "")
    .option("--connections <text>", "Connections to other work", "")
    .option("--build-on <text>", "Would you build on this?", "")
    .action(async (paperId, opts, cmd) => {
      await withCliTrace("cli.review.submit", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        // Validate all fields via the applicative validator
        const validated = validateReviewData({
          noveltyScore: parseInt(opts.novelty, 10),
          correctnessScore: parseInt(opts.correctness, 10),
          clarityScore: parseInt(opts.clarity, 10),
          significanceScore: parseInt(opts.significance, 10),
          priorWorkScore: parseInt(opts.priorWork, 10),
          summary: opts.summary,
          strengths: opts.strengths,
          weaknesses: opts.weaknesses,
          questions: opts.questions,
          connections: opts.connections,
          verdict: opts.verdict,
          buildOn: opts.buildOn,
        });

        if (validated.isErr()) {
          throw new CliError(validated.error);
        }
        trace.mark("validate");

        const reviewData = validated.value;

        const paper = await trace.step("db-query", () =>
          prisma.paper.findUnique({
            where: { paperId },
            select: { id: true, status: true },
          }),
        );
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        if (paper.status !== "under-review") {
          throw new CliError("Paper is not under review", { paperId, status: paper.status });
        }

        // Reviewer must be assigned (placeholder exists)
        const existing = await trace.step("db-query", () =>
          prisma.review.findUnique({
            where: {
              paperId_reviewerId: { paperId: paper.id, reviewerId: user.id },
            },
          }),
        );
        if (!existing) {
          throw new CliError("You have not been assigned to review this paper", { paperId, reviewer: user.githubLogin });
        }

        await trace.step("db-create", () =>
          prisma.review.update({
            where: {
              paperId_reviewerId: { paperId: paper.id, reviewerId: user.id },
            },
            data: {
              noveltyScore: reviewData.noveltyScore,
              correctnessScore: reviewData.correctnessScore,
              clarityScore: reviewData.clarityScore,
              significanceScore: reviewData.significanceScore,
              priorWorkScore: reviewData.priorWorkScore,
              summary: reviewData.summary,
              strengths: reviewData.strengths,
              weaknesses: reviewData.weaknesses,
              questions: reviewData.questions,
              connections: reviewData.connections,
              verdict: reviewData.verdict,
              buildOn: reviewData.buildOn,
            },
          }),
        );

        output({ paperId, reviewer: user.githubLogin, verdict: reviewData.verdict }, cmd);
      });
    });

  // ── show ────────────────────────────────────────────────
  review
    .command("show <paperId>")
    .description("Show reviews for a paper (visibility-gated)")
    .action(async (paperId, _opts, cmd) => {
      await withCliTrace("cli.review.show", cmd, async (trace) => {
        const login = cmd.optsWithGlobals().as as string | undefined;
        let isEditor = false;

        if (login) {
          const user = await trace.step("db-query", () =>
            prisma.user.findUnique({
              where: { githubLogin: login },
              select: { role: true },
            }),
          );
          if (user && EDITOR_ROLES.includes(user.role)) isEditor = true;
        }
        trace.mark("auth");

        const paper = await trace.step("db-query", () =>
          prisma.paper.findUnique({
            where: { paperId },
            select: { id: true },
          }),
        );
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        const where = isEditor
          ? { paperId: paper.id }
          : { paperId: paper.id, visible: true };

        const reviews = await trace.step("db-query", () =>
          prisma.review.findMany({
            where,
            select: {
              id: true,
              noveltyScore: true,
              correctnessScore: true,
              clarityScore: true,
              significanceScore: true,
              priorWorkScore: true,
              summary: true,
              strengths: true,
              weaknesses: true,
              questions: true,
              connections: true,
              verdict: true,
              buildOn: true,
              visible: true,
              createdAt: true,
              reviewer: { select: { githubLogin: true, displayName: true } },
            },
          }),
        );

        output(reviews, cmd);
      });
    });
}
