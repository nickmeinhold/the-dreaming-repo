/**
 * GUI CLI — paper commands
 *
 * Paper submission, listing, detail, and download — all via the browser.
 * Each command is wrapped with withGuiTrace for correlation ID threading.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { PapersListPage } from "@/gui-cli/pages/papers-list.page";
import { PaperDetailPage } from "@/gui-cli/pages/paper-detail.page";
import { SubmitPage } from "@/gui-cli/pages/submit.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerPaperCommands(program: Command): void {
  const paper = program.command("paper").description("Paper management");

  paper
    .command("submit")
    .description("Submit a new paper")
    .requiredOption("--title <title>", "Paper title")
    .requiredOption("--abstract <abstract>", "Paper abstract")
    .requiredOption("--category <category>", "Category: research | expository")
    .requiredOption("--pdf <path>", "Path to PDF file")
    .option("--latex <path>", "Path to LaTeX source")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.paper.submit", cmd },
        async (page) => {
          const submitPage = new SubmitPage(page, baseUrl);
          return submitPage.submit({
            title: opts.title,
            abstract: opts.abstract,
            category: opts.category,
            tags: opts.tags,
            pdfPath: opts.pdf,
            latexPath: opts.latex,
          });
        },
      );
      output(result, cmd);
    });

  paper
    .command("list")
    .description("List papers")
    .option("--status <status>", "Filter by status (editors only)")
    .option("--category <category>", "Filter by category")
    .option("--page <n>", "Page number", "1")
    .action(async (opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.paper.list", cmd, requiresAuth: false },
        async (page) => {
          const papersPage = new PapersListPage(page, baseUrl);
          papersPage.setFilters(opts.category, parseInt(opts.page));
          return papersPage.getPapers();
        },
      );
      output(result, cmd);
    });

  paper
    .command("show <paperId>")
    .description("Show paper detail")
    .action(async (paperId: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.paper.show", cmd, requiresAuth: false },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          return detailPage.getDetail();
        },
      );
      output(result, cmd);
    });

  paper
    .command("download <paperId>")
    .description("Download paper file")
    .option("--file-type <format>", "File type: pdf | latex", "pdf")
    .option("--output <path>", "Output file path")
    .action(async (paperId: string, opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.paper.download", cmd, requiresAuth: false },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          return detailPage.downloadFile(opts.fileType, opts.output);
        },
      );
      output(result, cmd);
    });
}
