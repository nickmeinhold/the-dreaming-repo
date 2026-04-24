/**
 * Logs Command — Query the AuditLog
 *
 * Provides a filtered, organized view of what happened in the system.
 * Queries the AuditLog table (not Pino stdout) so it works after
 * the fact — you don't need to have been watching the terminal.
 *
 * Usage:
 *   journal logs                          # last 50 events
 *   journal logs --entity paper           # just paper events
 *   journal logs --action paper.submitted # specific action
 *   journal logs --last 1h               # last hour
 *   journal logs --last 24h --entity auth # auth events today
 *   journal logs --level error            # errors only (access.denied, system.error)
 *   journal logs --user RaggedR           # events by this user
 *   journal logs --corr abc-123          # find all events from one request
 *   journal logs summary                  # grouped summary
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { output } from "@/cli/helpers";

const ERROR_ACTIONS = ["access.denied", "system.error", "auth.failed"];
const WARN_ACTIONS = ["access.denied", "auth.failed"];

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000; // days
}

export function registerLogsCommand(program: Command): void {
  const logs = program.command("logs").description("Query audit log");

  // ── logs (default: recent events) ──────────────────────
  logs
    .command("recent", { isDefault: true })
    .description("Recent audit events (default)")
    .option("--entity <entity>", "Filter by entity: paper, review, note, user, system")
    .option("--action <action>", "Filter by action (e.g. paper.submitted)")
    .option("--last <duration>", "Time window: 30m, 1h, 24h, 7d", "24h")
    .option("--level <level>", "Filter: error, warn, all", "all")
    .option("--user <login>", "Filter by user GitHub login")
    .option("--corr <id>", "Filter by correlationId")
    .option("--limit <n>", "Max results", "50")
    .action(async (opts, cmd) => {
      const since = new Date(Date.now() - parseDuration(opts.last));
      const limit = parseInt(opts.limit, 10);

      // Build where clause
      const where: Record<string, unknown> = {
        timestamp: { gte: since },
      };
      if (opts.entity) where.entity = opts.entity;
      if (opts.action) where.action = opts.action;
      if (opts.corr) where.correlationId = opts.corr;
      if (opts.level === "error") {
        where.action = { in: ERROR_ACTIONS };
      } else if (opts.level === "warn") {
        where.action = { in: WARN_ACTIONS };
      }

      // User filter requires a join
      let userId: number | undefined;
      if (opts.user) {
        const user = await prisma.user.findUnique({
          where: { githubLogin: opts.user },
          select: { id: true },
        });
        if (user) userId = user.id;
        else {
          output({ events: [], total: 0, message: `User "${opts.user}" not found` }, cmd);
          return;
        }
        where.userId = userId;
      }

      const [events, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      const formatted = events.map((e) => ({
        time: e.timestamp.toISOString().replace("T", " ").slice(0, 19),
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        details: e.details ? tryParseJson(e.details) : null,
        userId: e.userId,
        correlationId: e.correlationId,
      }));

      output({
        events: formatted,
        showing: formatted.length,
        total,
        since: since.toISOString(),
      }, cmd);
    });

  // ── logs summary ───────────────────────────────────────
  logs
    .command("summary")
    .description("Grouped summary of recent activity")
    .option("--last <duration>", "Time window: 1h, 24h, 7d", "24h")
    .action(async (opts, cmd) => {
      const since = new Date(Date.now() - parseDuration(opts.last));

      const counts = await prisma.auditLog.groupBy({
        by: ["action"],
        where: { timestamp: { gte: since } },
        _count: true,
        orderBy: { _count: { action: "desc" } },
      });

      const summary = counts.map((c) => ({
        action: c.action,
        count: c._count,
      }));

      const totalEvents = summary.reduce((sum, s) => sum + s.count, 0);

      // Get error count
      const errorCount = await prisma.auditLog.count({
        where: {
          timestamp: { gte: since },
          action: { in: ERROR_ACTIONS },
        },
      });

      // Get unique users active
      const activeUsers = await prisma.auditLog.groupBy({
        by: ["userId"],
        where: {
          timestamp: { gte: since },
          userId: { not: null },
        },
      });

      output({
        period: opts.last,
        since: since.toISOString(),
        totalEvents,
        errors: errorCount,
        activeUsers: activeUsers.length,
        breakdown: summary,
      }, cmd);
    });
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
