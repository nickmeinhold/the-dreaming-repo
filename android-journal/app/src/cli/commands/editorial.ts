/**
 * Editorial Commands — Status transitions, reviewer assignment, dashboard
 *
 * These commands are editor-only (enforced by resolveEditor).
 * The status transition calls transitionPaper() directly — same
 * optimistic-locking, same side effects (reviews become visible
 * on acceptance/publication).
 *
 * The dashboard groups papers by status with reviewer info,
 * giving editors a CLI equivalent of the web dashboard.
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { transitionPaper } from "@/lib/paper-workflow";
import { CliError, output, resolveEditor, withCliTrace } from "@/cli/helpers";

export function registerEditorialCommands(program: Command): void {
  const editorial = program.command("editorial").description("Editorial workflow (editor role required)");

  // ── status ──────────────────────────────────────────────
  editorial
    .command("status <paperId> <newStatus>")
    .description("Transition paper status (e.g. submitted → under-review)")
    .action(async (paperId, newStatus, _opts, cmd) => {
      await withCliTrace("cli.editorial.status", cmd, async (trace) => {
        await resolveEditor(cmd);
        trace.mark("auth");

        const result = await trace.step("db-create", () =>
          transitionPaper(prisma, paperId, newStatus),
        );
        if (!result.success) {
          throw new CliError(result.error ?? "Transition failed");
        }

        output({ paperId, status: newStatus }, cmd);
      });
    });

  // ── assign ──────────────────────────────────────────────
  editorial
    .command("assign <paperId> <reviewerLogin>")
    .description("Assign a reviewer to a paper")
    .action(async (paperId, reviewerLogin, _opts, cmd) => {
      await withCliTrace("cli.editorial.assign", cmd, async (trace) => {
        await resolveEditor(cmd);
        trace.mark("auth");

        const reviewer = await trace.step("db-query", () =>
          prisma.user.findUnique({
            where: { githubLogin: reviewerLogin },
            select: { id: true },
          }),
        );
        if (!reviewer) {
          throw new CliError(`User not found: ${reviewerLogin}`, { login: reviewerLogin });
        }

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
          throw new CliError("Paper must be under review to assign reviewers", { paperId, status: paper.status });
        }
        trace.mark("validate");

        // Prevent authors from reviewing their own paper
        const isAuthor = await trace.step("db-query", () =>
          prisma.paperAuthor.findUnique({
            where: { paperId_userId: { paperId: paper.id, userId: reviewer.id } },
          }),
        );
        if (isAuthor) {
          throw new CliError("Cannot assign a paper's author as reviewer", { paperId, reviewer: reviewerLogin });
        }

        // Check for existing review
        const existing = await trace.step("db-query", () =>
          prisma.review.findUnique({
            where: { paperId_reviewerId: { paperId: paper.id, reviewerId: reviewer.id } },
          }),
        );
        if (existing) {
          throw new CliError("Already assigned", { paperId, reviewer: reviewerLogin });
        }

        // Create placeholder review
        await trace.step("db-create", () =>
          prisma.review.create({
            data: {
              paperId: paper.id,
              reviewerId: reviewer.id,
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
          }),
        );

        output({ paperId, reviewer: reviewerLogin, status: "assigned" }, cmd);
      });
    });

  // ── dashboard ───────────────────────────────────────────
  editorial
    .command("dashboard")
    .description("Show papers grouped by status with reviewer info")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.editorial.dashboard", cmd, async (trace) => {
        await resolveEditor(cmd);
        trace.mark("auth");

        const papers = await trace.step("db-query", () =>
          prisma.paper.findMany({
            select: {
              paperId: true,
              title: true,
              status: true,
              category: true,
              submittedAt: true,
              authors: {
                include: { user: { select: { githubLogin: true, displayName: true } } },
                orderBy: { order: "asc" as const },
              },
              reviews: {
                select: {
                  verdict: true,
                  reviewer: { select: { githubLogin: true } },
                },
              },
            },
            orderBy: { submittedAt: "desc" },
          }),
        );

        // Group by status
        const grouped: Record<string, typeof papers> = {};
        for (const p of papers) {
          (grouped[p.status] ??= []).push(p);
        }

        output(grouped, cmd);
      });
    });
}
