/**
 * GUI CLI — search and tag commands
 *
 * Full-text search and tag browsing via the browser.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { SearchPage } from "@/gui-cli/pages/search.page";
import { TagsListPage, TagDetailPage } from "@/gui-cli/pages/tags.page";
import { output, getBaseUrl } from "@/gui-cli/helpers";

export function registerSearchCommands(program: Command): void {
  program
    .command("search <query>")
    .description("Full-text search across published papers")
    .option("--category <category>", "Filter by category: research | expository")
    .option("--page <n>", "Page number", "1")
    .action(async (query: string, opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.search", cmd, requiresAuth: false },
        async (page) => {
          const searchPage = new SearchPage(page, baseUrl);
          searchPage.setQuery(query, opts.category, parseInt(opts.page));
          return searchPage.search();
        },
      );
      output(result, cmd);
    });

  const tag = program.command("tag").description("Tag browsing");

  tag
    .command("list")
    .description("List all tags with paper counts")
    .action(async (_opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.tag.list", cmd, requiresAuth: false },
        async (page) => {
          const tagsPage = new TagsListPage(page, baseUrl);
          return tagsPage.getTags();
        },
      );
      output(result, cmd);
    });

  tag
    .command("show <slug>")
    .description("Show published papers for a tag")
    .action(async (slug: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.tag.show", cmd, requiresAuth: false },
        async (page) => {
          const tagPage = new TagDetailPage(page, baseUrl, slug);
          return tagPage.getTagPapers();
        },
      );
      output(result, cmd);
    });
}
