/**
 * GUI CLI — review commands
 *
 * Peer review submission and viewing via the browser.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { ReviewPage } from "@/gui-cli/pages/review.page";
import { PaperDetailPage } from "@/gui-cli/pages/paper-detail.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerReviewCommands(program: Command): void {
  const review = program.command("review").description("Peer review");

  review
    .command("submit <paperId>")
    .description("Submit a peer review")
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
    .action(async (paperId: string, opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.review.submit", cmd },
        async (page) => {
          const reviewPage = new ReviewPage(page, baseUrl, paperId);
          return reviewPage.submitReview({
            novelty: parseInt(opts.novelty),
            correctness: parseInt(opts.correctness),
            clarity: parseInt(opts.clarity),
            significance: parseInt(opts.significance),
            priorWork: parseInt(opts.priorWork),
            verdict: opts.verdict,
            summary: opts.summary,
            strengths: opts.strengths,
            weaknesses: opts.weaknesses,
            questions: opts.questions,
            connections: opts.connections,
            buildOn: opts.buildOn,
          });
        },
      );
      output(result, cmd);
    });

  review
    .command("show <paperId>")
    .description("Show reviews for a paper")
    .action(async (paperId: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.review.show", cmd, requiresAuth: false },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          const detail = await detailPage.getDetail();
          return detail.reviews;
        },
      );
      output(result, cmd);
    });
}
