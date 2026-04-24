/**
 * Social Commands — Notes, favourites, read marking
 *
 * The social layer mirrors the server actions but replaces
 * requireAuth() + requirePaper() with resolveUser() + a direct
 * Prisma lookup. The favourite toggle preserves the atomic
 * deleteMany-then-create pattern with P2002 handling.
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { validateNoteContent } from "@/lib/validation/schemas";
import { CliError, output, resolveUser, withCliTrace } from "@/cli/helpers";

/** Look up a paper visible to the caller. Non-editors see published only. */
async function findPaper(paperId: string, role: string) {
  const where = EDITOR_ROLES.includes(role)
    ? { paperId }
    : { paperId, status: "published" as const };
  return prisma.paper.findFirst({ where, select: { id: true, paperId: true } });
}

export function registerSocialCommands(program: Command): void {
  // ── Notes ───────────────────────────────────────────────
  const note = program.command("note").description("Paper notes (threaded)");

  note
    .command("add <paperId> <content>")
    .description("Add a note to a paper")
    .option("--reply-to <noteId>", "Reply to an existing note")
    .action(async (paperId, content, opts, cmd) => {
      await withCliTrace("cli.note.add", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        const contentResult = validateNoteContent(content);
        if (contentResult.isErr()) {
          throw new CliError(contentResult.error);
        }
        trace.mark("validate");

        const paper = await trace.step("db-query", () => findPaper(paperId, user.role));
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        const parentId = opts.replyTo ? parseInt(opts.replyTo, 10) : null;
        if (parentId) {
          const parent = await trace.step("db-query", () =>
            prisma.note.findUnique({
              where: { id: parentId },
              select: { paperId: true },
            }),
          );
          if (!parent || parent.paperId !== paper.id) {
            throw new CliError("Invalid parent note", { paperId, parentId });
          }
        }

        const created = await trace.step("db-create", () =>
          prisma.note.create({
            data: {
              content: content.trim(),
              paperId: paper.id,
              userId: user.id,
              parentId,
            },
            select: { id: true, content: true, createdAt: true },
          }),
        );

        output(created, cmd);
      });
    });

  note
    .command("list <paperId>")
    .description("List notes on a paper")
    .action(async (paperId, _opts, cmd) => {
      await withCliTrace("cli.note.list", cmd, async (trace) => {
        const login = cmd.optsWithGlobals().as as string | undefined;
        let role = "user";
        if (login) {
          const u = await trace.step("db-query", () =>
            prisma.user.findUnique({
              where: { githubLogin: login },
              select: { role: true },
            }),
          );
          if (u) role = u.role;
        }
        trace.mark("auth");

        const paper = await trace.step("db-query", () => findPaper(paperId, role));
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        const notes = await trace.step("db-query", () =>
          prisma.note.findMany({
            where: { paperId: paper.id },
            include: {
              user: { select: { githubLogin: true, displayName: true } },
            },
            orderBy: { createdAt: "asc" },
          }),
        );

        output(notes, cmd);
      });
    });

  // ── Favourites ──────────────────────────────────────────
  const favourite = program.command("favourite").description("Paper favourites");

  favourite
    .command("toggle <paperId>")
    .description("Toggle favourite on a paper")
    .action(async (paperId, _opts, cmd) => {
      await withCliTrace("cli.favourite.toggle", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        const paper = await trace.step("db-query", () => findPaper(paperId, user.role));
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        // Atomic toggle: try delete first, create if nothing deleted
        const { count } = await trace.step("db-create", () =>
          prisma.favourite.deleteMany({
            where: { paperId: paper.id, userId: user.id },
          }),
        );

        if (count > 0) {
          output({ paperId, favourited: false }, cmd);
          return;
        }

        try {
          await trace.step("db-create", () =>
            prisma.favourite.create({
              data: { paperId: paper.id, userId: user.id },
            }),
          );
          output({ paperId, favourited: true }, cmd);
        } catch (e: unknown) {
          if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
            output({ paperId, favourited: true }, cmd);
            return;
          }
          throw e;
        }
      });
    });

  favourite
    .command("list")
    .description("List your favourited papers")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.favourite.list", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        const favourites = await trace.step("db-query", () =>
          prisma.favourite.findMany({
            where: { userId: user.id },
            include: {
              paper: {
                select: { paperId: true, title: true, category: true, status: true },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
        );

        output(
          favourites.map((f) => ({
            paperId: f.paper.paperId,
            title: f.paper.title,
            category: f.paper.category,
            favouritedAt: f.createdAt,
          })),
          cmd,
        );
      });
    });

  // ── Read Marking ────────────────────────────────────────
  const read = program.command("read").description("Read marking and history");

  read
    .command("mark <paperId>")
    .description("Mark a paper as read")
    .action(async (paperId, _opts, cmd) => {
      await withCliTrace("cli.read.mark", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        const paper = await trace.step("db-query", () => findPaper(paperId, user.role));
        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        // Find most recent download, update it; else create new
        const download = await trace.step("db-query", () =>
          prisma.download.findFirst({
            where: { paperId: paper.id, userId: user.id },
            orderBy: { createdAt: "desc" },
          }),
        );

        if (download) {
          await trace.step("db-create", () =>
            prisma.download.update({
              where: { id: download.id },
              data: { read: true },
            }),
          );
        } else {
          await trace.step("db-create", () =>
            prisma.download.create({
              data: { paperId: paper.id, userId: user.id, read: true },
            }),
          );
        }

        output({ paperId, read: true }, cmd);
      });
    });

  read
    .command("history")
    .description("Show your reading history")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.read.history", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        const downloads = await trace.step("db-query", () =>
          prisma.download.findMany({
            where: { userId: user.id },
            include: {
              paper: {
                select: { paperId: true, title: true, category: true },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
        );

        output(
          downloads.map((d) => ({
            paperId: d.paper.paperId,
            title: d.paper.title,
            category: d.paper.category,
            read: d.read,
            downloadedAt: d.createdAt,
          })),
          cmd,
        );
      });
    });
}
