/**
 * GUI CLI — social commands
 *
 * Notes, favourites, and read marking via the browser.
 */

import type { Command } from "commander";
import { withGuiTrace } from "@/gui-cli/trace";
import { PaperDetailPage } from "@/gui-cli/pages/paper-detail.page";
import { UserProfilePage } from "@/gui-cli/pages/user-profile.page";
import { output, requireLogin, getBaseUrl } from "@/gui-cli/helpers";

export function registerSocialCommands(program: Command): void {
  // ── Notes ──────────────────────────────────────────────

  const note = program.command("note").description("Paper notes");

  note
    .command("add <paperId> <content>")
    .description("Add a note to a paper")
    .option("--reply-to <noteId>", "Reply to an existing note")
    .action(async (paperId: string, content: string, opts, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.note.add", cmd },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          return detailPage.addNote(content, opts.replyTo ? parseInt(opts.replyTo) : undefined);
        },
      );
      output(result, cmd);
    });

  note
    .command("list <paperId>")
    .description("List notes on a paper")
    .action(async (paperId: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.note.list", cmd, requiresAuth: false },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          const detail = await detailPage.getDetail();
          return detail.notes;
        },
      );
      output(result, cmd);
    });

  // ── Favourites ─────────────────────────────────────────

  const favourite = program.command("favourite").description("Paper favourites");

  favourite
    .command("toggle <paperId>")
    .description("Toggle favourite on a paper")
    .action(async (paperId: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.favourite.toggle", cmd },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          return detailPage.toggleFavourite();
        },
      );
      output(result, cmd);
    });

  favourite
    .command("list")
    .description("List your favourited papers")
    .action(async (_opts: unknown, cmd: Command) => {
      const login = requireLogin(cmd);
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.favourite.list", cmd },
        async (page) => {
          const profilePage = new UserProfilePage(page, baseUrl, login);
          return profilePage.getFavourites();
        },
      );
      output(result, cmd);
    });

  // ── Read Marking ───────────────────────────────────────

  const read = program.command("read").description("Read marking");

  read
    .command("mark <paperId>")
    .description("Mark a paper as read")
    .action(async (paperId: string, _opts: unknown, cmd: Command) => {
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.read.mark", cmd },
        async (page) => {
          const detailPage = new PaperDetailPage(page, baseUrl, paperId);
          return detailPage.markAsRead();
        },
      );
      output(result, cmd);
    });

  read
    .command("history")
    .description("Show your reading history")
    .action(async (_opts: unknown, cmd: Command) => {
      const login = requireLogin(cmd);
      const baseUrl = getBaseUrl(cmd);
      const result = await withGuiTrace(
        { action: "gui.read.history", cmd },
        async (page) => {
          const profilePage = new UserProfilePage(page, baseUrl, login);
          return profilePage.getReadHistory();
        },
      );
      output(result, cmd);
    });
}
