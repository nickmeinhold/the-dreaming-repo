/**
 * E2E Trace Logging — Step-Level Action Observability
 *
 * Every user action (Server Action or raw API route) that goes through
 * `withActionTrace` logs a complete trace of every internal step:
 * auth, validation, DB queries, file writes, etc.
 *
 * This fixes the AsyncLocalStorage gap: Server Actions bypass the
 * RouteBuilder pipeline, so without this wrapper, correlationId and
 * userId are null in all downstream logging.
 *
 * Usage:
 *   export async function submitPaper(formData: FormData) {
 *     return withActionTrace("paper.submit", async (trace) => {
 *       const session = await getSession();
 *       if (!session) { trace.fail("auth", "unauthenticated"); return err(...); }
 *       trace.mark("auth");
 *
 *       const result = await trace.step("db-create", () => prisma.$transaction(...));
 *       await trace.step("file-store", () => storePaperFiles(...));
 *       return { success: true, paperId: result.paperId };
 *     });
 *   }
 *
 * Output (Pino JSON):
 *   {
 *     "correlationId": "abc-123",
 *     "userId": 42,
 *     "trace": {
 *       "action": "paper.submit",
 *       "ms": 245,
 *       "status": "ok",
 *       "steps": [
 *         { "name": "auth", "status": "ok", "ms": 0 },
 *         { "name": "db-create", "status": "ok", "ms": 12 },
 *         { "name": "file-store", "status": "ok", "ms": 8 }
 *       ]
 *     }
 *   }
 */

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { logAuditEvent } from "@/lib/audit";
import { requestStore } from "@/lib/middleware/async-context";
import { headers as getHeaders } from "next/headers";

// ── Types ──────────────────────────────────────────────────

export interface StepRecord {
  name: string;
  status: "ok" | "err";
  ms: number;
  error?: string;
}


// ── TraceRecorder ──────────────────────────────────────────

export class TraceRecorder {
  private steps: StepRecord[] = [];

  /**
   * Wrap an async operation as a traced step.
   * Records timing and success/failure. Re-throws on error.
   */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.steps.push({ name, status: "ok", ms: Math.round(performance.now() - start) });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push({ name, status: "err", ms: Math.round(performance.now() - start), error: message });
      throw err;
    }
  }

  /** Record a passed synchronous check (0ms). */
  mark(name: string): void {
    this.steps.push({ name, status: "ok", ms: 0 });
  }

  /** Record a failed check — for early-return paths, not throws. */
  fail(name: string, error: string): void {
    this.steps.push({ name, status: "err", ms: 0, error });
  }

  getSteps(): StepRecord[] {
    return [...this.steps];
  }
}

// ── Test Hook ──────────────────────────────────────────────

export interface ActionTrace {
  action: string;
  correlationId: string;
  ms: number;
  status: "ok" | "err";
  steps: StepRecord[];
  error?: string;
}

/** @internal — last completed trace, exposed for testing */
export let _lastTrace: ActionTrace | null = null;

/** @internal — reset between tests */
export function _resetTrace(): void {
  _lastTrace = null;
}

// ── withActionTrace ────────────────────────────────────────

/**
 * Wraps a Server Action or raw route handler with full trace logging.
 *
 * 1. Generates a correlationId
 * 2. Sets up AsyncLocalStorage (fixing the Server Action gap)
 * 3. Creates a TraceRecorder for step-level instrumentation
 * 4. Logs the complete trace on completion
 */
export async function withActionTrace<T>(
  actionName: string,
  fn: (trace: TraceRecorder) => Promise<T>,
): Promise<T> {
  // Check for an incoming correlation ID from an upstream caller
  // (e.g. the GUI CLI injects X-Correlation-Id via browser headers).
  // If present, reuse it so all backend traces from one GUI CLI command
  // share the same correlationId. Otherwise generate a fresh one.
  let correlationId: string;
  let batchId: string | undefined;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const hdrs = await getHeaders();
    const rawCorr = hdrs.get("x-correlation-id");
    // Only trust correlation/batch IDs that look like UUIDs (max 36 chars).
    // Prevents external callers from injecting arbitrary values into the audit trail.
    correlationId = rawCorr && UUID_RE.test(rawCorr) ? rawCorr : crypto.randomUUID();
    const rawBatch = hdrs.get("x-batch-id");
    batchId = rawBatch && /^[\w-]{1,64}$/.test(rawBatch) ? rawBatch : undefined;
  } catch {
    // headers() fails outside request context (CLI tests, etc.) — generate fresh
    correlationId = crypto.randomUUID();
  }

  const trace = new TraceRecorder();
  const start = performance.now();

  // Set up ALS with .run() — creates an isolated async context so concurrent
  // Server Actions don't contaminate each other's correlationId/userId.
  // (enterWith would mutate the shared context — a correctness bug under load.)
  let userId: number | null = null;
  try {
    const session = await getSession();
    userId = session?.userId ?? null;
  } catch {
    // getSession may fail outside request context (e.g. tests) — that's fine
  }

  return requestStore.run({ correlationId, userId, batchId }, async () => {
    try {
      const result = await fn(trace);
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

      // Derive category from action name (e.g. "paper.submit" → "paper")
      const cat = actionName.split(".")[0];

      if (hasFailedStep) {
        const lastFail = steps.findLast((s) => s.status === "err");
        actionTrace.error = lastFail?.error;
        logger.warn({ cat, trace: actionTrace }, `${actionName} rejected`);
      } else {
        logger.info({ cat, trace: actionTrace }, `${actionName} completed`);
      }

      _lastTrace = actionTrace;

      // Store trace summary in AuditLog — makes traces queryable from dashboard
      await logAuditEvent({
        action: `trace.${actionName}`,
        entity: cat,
        entityId: actionName,
        durationMs: actionTrace.ms,
        status: actionTrace.status,
        details: JSON.stringify({
          status: actionTrace.status,
          ms: actionTrace.ms,
          steps: steps.map((s) => `${s.name}:${s.status}`).join(" → "),
          error: actionTrace.error,
        }),
      });

      return result;
    } catch (err: unknown) {
      const ms = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      const actionTrace: ActionTrace = {
        action: actionName,
        correlationId,
        ms,
        status: "err",
        steps: trace.getSteps(),
        error: message,
      };
      const cat = actionName.split(".")[0];
      logger.error({ cat, err, trace: actionTrace }, `${actionName} threw`);
      _lastTrace = actionTrace;

      await logAuditEvent({
        action: `trace.${actionName}`,
        entity: cat,
        entityId: actionName,
        durationMs: actionTrace.ms,
        status: "err",
        details: JSON.stringify({
          status: "err",
          ms: actionTrace.ms,
          steps: actionTrace.steps.map((s) => `${s.name}:${s.status}`).join(" → "),
          error: message,
        }),
      });

      throw err;
    }
  });
}
