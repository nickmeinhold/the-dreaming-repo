/**
 * User Commands — CRUD + interest matching
 *
 * Mirrors the user management that the web app spreads across
 * GitHub OAuth callback + profile pages, but as direct Prisma calls
 * controlled by CLI flags.
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { findSimilarUsers } from "@/lib/interest-matching";
import { CliError, output, resolveUser, withCliTrace } from "@/cli/helpers";
import { logAuditEvent } from "@/lib/audit";

const VALID_AUTHOR_TYPES = ["autonomous", "claude-human", "human"] as const;
const VALID_ROLES = ["user", "editor", "admin"] as const;

export function registerUserCommands(program: Command): void {
  const user = program.command("user").description("Manage users");

  // ── create ──────────────────────────────────────────────
  user
    .command("create")
    .description("Create a new user")
    .requiredOption("--login <login>", "GitHub login (unique)")
    .requiredOption("--name <name>", "Display name")
    .requiredOption("--type <type>", "Author type: autonomous | claude-human | human")
    .option("--role <role>", "Role: user | editor | admin", "user")
    .option("--github-id <id>", "GitHub numeric ID", "0")
    .option("--human <name>", "Human collaborator name (for claude-human)")
    .action(async (opts, cmd) => {
      await withCliTrace("cli.user.create", cmd, async (trace) => {
        if (!VALID_AUTHOR_TYPES.includes(opts.type)) {
          throw new CliError(`Invalid author type: "${opts.type}". Must be one of: ${VALID_AUTHOR_TYPES.join(", ")}`);
        }
        if (!VALID_ROLES.includes(opts.role)) {
          throw new CliError(`Invalid role: "${opts.role}". Must be one of: ${VALID_ROLES.join(", ")}`);
        }
        trace.mark("validate");

        try {
          const created = await trace.step("db-create", () =>
            prisma.user.create({
              data: {
                githubId: parseInt(opts.githubId, 10),
                githubLogin: opts.login,
                displayName: opts.name,
                authorType: opts.type,
                role: opts.role,
                humanName: opts.human ?? null,
              },
            }),
          );
          await logAuditEvent({
            action: "user.created",
            entity: "user",
            entityId: String(created.id),
            details: JSON.stringify({ githubLogin: opts.login, role: opts.role, authorType: opts.type }),
          });
          trace.mark("audit");

          output({ id: created.id, githubLogin: created.githubLogin, displayName: created.displayName, role: created.role }, cmd);
        } catch (e) {
          const isUnique = e instanceof Error && "code" in e && (e as { code: string }).code === "P2002";
          if (isUnique) {
            throw new CliError(`User with login "${opts.login}" already exists`);
          }
          throw e;
        }
      });
    });

  // ── list ────────────────────────────────────────────────
  user
    .command("list")
    .description("List all users")
    .action(async (_opts, cmd) => {
      await withCliTrace("cli.user.list", cmd, async (trace) => {
        const users = await trace.step("db-query", () =>
          prisma.user.findMany({
            select: {
              id: true,
              githubLogin: true,
              displayName: true,
              authorType: true,
              role: true,
            },
            orderBy: { createdAt: "asc" },
          }),
        );
        output(users, cmd);
      });
    });

  // ── show ────────────────────────────────────────────────
  user
    .command("show <login>")
    .description("Show user profile with counts")
    .action(async (login, _opts, cmd) => {
      await withCliTrace("cli.user.show", cmd, async (trace) => {
        const found = await trace.step("db-query", () =>
          prisma.user.findUnique({
            where: { githubLogin: login },
            include: {
              _count: {
                select: {
                  authorships: true,
                  reviews: true,
                  favourites: true,
                  notes: true,
                  downloads: true,
                },
              },
            },
          }),
        );

        if (!found) {
          throw new CliError(`User not found: ${login}`, { login });
        }

        output(
          {
            id: found.id,
            githubLogin: found.githubLogin,
            displayName: found.displayName,
            authorType: found.authorType,
            humanName: found.humanName,
            role: found.role,
            bio: found.bio,
            papers: found._count.authorships,
            reviews: found._count.reviews,
            favourites: found._count.favourites,
            notes: found._count.notes,
            downloads: found._count.downloads,
          },
          cmd,
        );
      });
    });

  // ── promote ─────────────────────────────────────────────
  user
    .command("promote <login>")
    .description("Change a user's role")
    .requiredOption("--role <role>", "New role: user | editor | admin")
    .action(async (login, opts, cmd) => {
      await withCliTrace("cli.user.promote", cmd, async (trace) => {
        if (!VALID_ROLES.includes(opts.role)) {
          throw new CliError(`Invalid role: "${opts.role}". Must be one of: ${VALID_ROLES.join(", ")}`);
        }
        trace.mark("validate");

        const found = await trace.step("db-query", () =>
          prisma.user.findUnique({ where: { githubLogin: login } }),
        );
        if (!found) {
          throw new CliError(`User not found: ${login}`, { login });
        }

        const updated = await trace.step("db-create", () =>
          prisma.user.update({
            where: { githubLogin: login },
            data: { role: opts.role },
            select: { githubLogin: true, role: true },
          }),
        );

        await logAuditEvent({
          action: "user.role.changed",
          entity: "user",
          entityId: String(found.id),
          details: JSON.stringify({ githubLogin: login, from: found.role, to: opts.role }),
        });
        trace.mark("audit");

        output(updated, cmd);
      });
    });

  // ── similar ─────────────────────────────────────────────
  user
    .command("similar <login>")
    .description("Find users with similar reading interests (Jaccard similarity)")
    .option("--limit <n>", "Max results", "10")
    .action(async (login, opts, cmd) => {
      await withCliTrace("cli.user.similar", cmd, async (trace) => {
        const caller = await trace.step("db-query", () =>
          prisma.user.findUnique({
            where: { githubLogin: login },
            select: { id: true },
          }),
        );

        if (!caller) {
          throw new CliError(`User not found: ${login}`, { login });
        }

        const similar = await trace.step("db-query", () =>
          findSimilarUsers(caller.id, parseInt(opts.limit, 10)),
        );
        output(similar, cmd);
      });
    });
}
