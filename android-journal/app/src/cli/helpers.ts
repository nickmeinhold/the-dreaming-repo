/**
 * CLI Helpers — Shared utilities for all commands
 *
 * resolveUser replaces getSession() from the web layer:
 * instead of reading a JWT cookie, it looks up `--as <login>` in the database.
 * resolveEditor adds a role guard on top.
 *
 * withCliTrace wraps every CLI command with step-level tracing —
 * same cascade as withActionTrace on the web side, but for CLI context.
 *
 * output/outputError give uniform JSON or table formatting.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logAuditEvent } from "@/lib/audit";
import { TraceRecorder, _resetTrace, type ActionTrace } from "@/lib/trace";
import { requestStore } from "@/lib/middleware/async-context";
import type { Command } from "commander";

// Re-export _lastCliTrace for testing
export let _lastCliTrace: ActionTrace | null = null;

export interface CliUser {
  id: number;
  githubLogin: string;
  displayName: string;
  authorType: string;
  humanName: string | null;
  role: string;
}

// ── CLI Trace Wrapper ─────────────────────────────────────

/**
 * Wraps a CLI command with full trace logging.
 * The CLI equivalent of withActionTrace — same correlationId,
 * same step recording, same AuditLog + Pino output.
 *
 * Usage:
 *   .action(async (opts, cmd) => {
 *     await withCliTrace("cli.paper.submit", cmd, async (trace) => {
 *       const user = await resolveUser(cmd);
 *       trace.mark("auth");
 *       // ...
 *     });
 *   });
 */
export async function withCliTrace(
  actionName: string,
  cmd: Command,
  fn: (trace: TraceRecorder) => Promise<void>,
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const batchId = process.env.BATCH_ID || undefined;
  const trace = new TraceRecorder();
  const start = performance.now();

  // Capture all command arguments for the trace — at 3am you want to
  // know exactly what was called with what
  const allOpts = cmd.optsWithGlobals();
  const args = cmd.args ?? [];
  const input = {
    ...(args.length > 0 ? { args } : {}),
    ...(allOpts.as ? { as: allOpts.as } : {}),
  };

  // Set up ALS so logAuditEvent gets the correlationId
  const login = allOpts.as as string | undefined;
  let userId: number | null = null;
  if (login) {
    const user = await prisma.user.findUnique({
      where: { githubLogin: login },
      select: { id: true },
    });
    userId = user?.id ?? null;
  }
  // Use .run() for isolated async context — consistent with withActionTrace.
  // Prevents concurrent CLI commands from contaminating each other's correlationId.
  await requestStore.run({ correlationId, userId, batchId }, async () => {
    const cat = actionName.split(".").slice(0, 2).join(".");

    try {
      await fn(trace);
      const ms = Math.round(performance.now() - start);
      const steps = trace.getSteps();
      const hasFailedStep = steps.some((s) => s.status === "err");

      const actionTrace: ActionTrace = {
        action: actionName,
        correlationId,
        ms,
        status: hasFailedStep ? "err" : "ok",
        steps,
      };

      if (hasFailedStep) {
        const lastFail = steps.findLast((s) => s.status === "err");
        actionTrace.error = lastFail?.error;
        logger.warn({ cat, input, trace: actionTrace }, `${actionName} rejected`);
      } else {
        logger.info({ cat, input, trace: actionTrace }, `${actionName} completed`);
      }

      _lastCliTrace = actionTrace;

      await logAuditEvent({
        action: `trace.${actionName}`,
        entity: cat,
        entityId: actionName,
        ...(batchId ? { batchId } : {}),
        details: JSON.stringify({
          input,
          status: actionTrace.status,
          ms: actionTrace.ms,
          steps: steps.map((s) => `${s.name}:${s.status}`).join(" → "),
          error: actionTrace.error,
        }),
      });
    } catch (err: unknown) {
      const ms = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      const steps = trace.getSteps();
      const actionTrace: ActionTrace = {
        action: actionName,
        correlationId,
        ms,
        status: "err",
        steps,
        error: message,
      };
      // Extract context from CliError for richer diagnostics
      const errorContext = err instanceof CliError ? err.context : {};

      logger.error({ cat, input, errorContext, err, trace: actionTrace }, `${actionName} threw`);

      _lastCliTrace = actionTrace;

      await logAuditEvent({
        action: `trace.${actionName}`,
        entity: cat,
        entityId: actionName,
        ...(batchId ? { batchId } : {}),
        details: JSON.stringify({
          input,
          ...(Object.keys(errorContext).length > 0 ? { errorContext } : {}),
          status: "err",
          ms,
          steps: steps.map((s) => `${s.name}:${s.status}`).join(" → "),
          error: message,
        }),
      });

      // CliError = expected failure (validation, not found, auth).
      // Output the error message and exit cleanly.
      if (err instanceof CliError) {
        outputError(err.message);
        process.exit(1);
      }
      throw err;
    }
  });
}

// ── CLI Error ─────────────────────────────────────────────

/**
 * Thrown instead of process.exit(1) inside withCliTrace.
 * The trace wrapper catches it, logs the trace with the failure step,
 * then the top-level handler outputs the error and exits.
 *
 * Carries structured context so the trace log includes everything
 * needed to debug at 3am: what was called, with what arguments,
 * and what went wrong.
 */
export class CliError extends Error {
  context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "CliError";
    this.context = context;
  }
}

// ── Auth Helpers ──────────────────────────────────────────

/** Look up the user specified by --as <login>. Throws CliError if missing or not found. */
export async function resolveUser(cmd: Command): Promise<CliUser> {
  const login = cmd.optsWithGlobals().as as string | undefined;
  if (!login) {
    throw new CliError("--as <login> is required for this command");
  }

  const user = await prisma.user.findUnique({
    where: { githubLogin: login },
    select: {
      id: true,
      githubLogin: true,
      displayName: true,
      authorType: true,
      humanName: true,
      role: true,
    },
  });

  if (!user) {
    throw new CliError(`User not found: ${login}`);
  }

  return user;
}

/** resolveUser + require editor or admin role. */
export async function resolveEditor(cmd: Command): Promise<CliUser> {
  const user = await resolveUser(cmd);
  if (user.role !== "editor" && user.role !== "admin") {
    throw new CliError(`User "${user.githubLogin}" is not an editor (role: ${user.role})`);
  }
  return user;
}

// ── Output Helpers ────────────────────────────────────────

/** Write data to stdout as JSON or a simple table. */
export function output(data: unknown, cmd: Command): void {
  const format = cmd.optsWithGlobals().format as string;
  if (format === "table" && Array.isArray(data)) {
    if (data.length === 0) {
      console.log("(no results)");
      return;
    }
    console.table(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/** Write a structured error to stderr as JSON. */
export function outputError(message: string): void {
  console.error(JSON.stringify({ error: message }));
}
