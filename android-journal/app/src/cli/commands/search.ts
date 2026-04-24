/**
 * Search Commands — Full-text search and tag browsing
 *
 * search calls searchPapers() directly — same tsvector query,
 * same category allowlist, same sanitization. No reimplementation.
 *
 * Tag commands query Prisma directly since the web app's tag
 * pages do the same (no shared pure function to import).
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { searchPapers } from "@/lib/search";
import { slugToLabel } from "@/lib/tags";
import { CliError, output, withCliTrace } from "@/cli/helpers";

export function registerSearchCommands(program: Command): void {
  // ── search ──────────────────────────────────────────────
  program
    .command("search <query>")
    .description("Full-text search across published papers")
    .option("--category <category>", "Filter by category: research | expository")
    .option("--page <n>", "Page number", "1")
    .action(async (query, opts, cmd) => {
      await withCliTrace("cli.search", cmd, async (trace) => {
        const page = parseInt(opts.page, 10);
        const limit = 20;
        const offset = (page - 1) * limit;

        const { results, total } = await trace.step("search", () =>
          searchPapers(query, {
            category: opts.category,
            limit,
            offset,
          }),
        );

        output({ results, total, page, pages: Math.ceil(total / limit) }, cmd);
      });
    });

  // ── tags ────────────────────────────────────────────────
  const tag = program.command("tag").description("Tag browsing");

  tag
    .command("list")
    .description("List all tags with paper counts")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.tag.list", cmd, async (trace) => {
        const tags = await trace.step("db-query", () =>
          prisma.tag.findMany({
            include: {
              _count: {
                select: { papers: true },
              },
            },
            orderBy: { slug: "asc" },
          }),
        );

        output(
          tags.map((t) => ({
            slug: t.slug,
            label: t.label,
            papers: t._count.papers,
          })),
          cmd,
        );
      });
    });

  tag
    .command("show <slug>")
    .description("Show published papers for a tag")
    .action(async (slug, _opts, cmd) => {
      await withCliTrace("cli.tag.show", cmd, async (trace) => {
        const found = await trace.step("db-query", () =>
          prisma.tag.findUnique({
            where: { slug },
            include: {
              papers: {
                where: { paper: { status: "published" } },
                include: {
                  paper: {
                    select: {
                      paperId: true,
                      title: true,
                      category: true,
                      submittedAt: true,
                    },
                  },
                },
              },
            },
          }),
        );

        if (!found) {
          throw new CliError(`Tag not found: ${slug}`, { slug });
        }

        output(
          {
            slug: found.slug,
            label: found.label,
            papers: found.papers.map((pt) => pt.paper),
          },
          cmd,
        );
      });
    });
}
