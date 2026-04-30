/**
 * GUI CLI Trace Wrapper
 *
 * Analogous to withCliTrace in src/cli/helpers.ts, but for the
 * browser-driven path. Generates a correlationId per command,
 * passes it to the browser via headers, and logs a wrapping trace.
 *
 * The frontend navigation and scraping are NOT traced — only
 * backend calls (server actions, API routes) are. The correlationId
 * header threads through withActionTrace() on the server, so all
 * backend traces from one GUI CLI command share the same ID.
 *
 * Log output goes to stderr (Pino-style JSON) so it doesn't
 * pollute the JSON output on stdout.
 */

import type { Page } from "playwright";
import type { Command } from "commander";
import { withBrowser, type BrowserOptions } from "./browser";
import { authenticateAs } from "./auth";
import { outputError, getBaseUrl, isHeadless } from "./helpers";

export interface GuiTraceOptions {
  /** Action name for the trace (e.g. "gui.paper.submit") */
  action: string;
  /** Commander Command for reading global options */
  cmd: Command;
  /** Whether this command requires authentication */
  requiresAuth?: boolean;
}

/**
 * Wraps a GUI CLI command with correlation ID generation and trace logging.
 *
 * 1. Generates a correlationId
 * 2. Reads BATCH_ID from env (for story seeding)
 * 3. Passes both to the browser context via headers
 * 4. Authenticates if --as is provided and requiresAuth is true
 * 5. Runs the command function
 * 6. Logs the wrapping trace to stderr
 */
export async function withGuiTrace<T>(
  opts: GuiTraceOptions,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const baseUrl = getBaseUrl(opts.cmd);
  const headless = isHeadless(opts.cmd);
  const login = opts.cmd.optsWithGlobals().as as string | undefined;
  const correlationId = crypto.randomUUID();
  const batchId = process.env.BATCH_ID || undefined;

  const start = performance.now();

  const browserOpts: BrowserOptions = {
    headless,
    correlationId,
    batchId,
  };

  try {
    const result = await withBrowser(baseUrl, async (page) => {
      // Authenticate if needed
      if (login && opts.requiresAuth !== false) {
        await authenticateAs(page, baseUrl, login);
      }
      return fn(page);
    }, browserOpts);

    const ms = Math.round(performance.now() - start);

    // Log the wrapping trace to stderr (Pino-compatible JSON)
    logTrace({
      action: opts.action,
      correlationId,
      batchId,
      ms,
      status: "ok",
      login,
    });

    return result;
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);

    logTrace({
      action: opts.action,
      correlationId,
      batchId,
      ms,
      status: "err",
      error: message,
      login,
    });

    outputError(message);
    process.exit(1);
  }
}

interface TraceLog {
  action: string;
  correlationId: string;
  batchId?: string;
  ms: number;
  status: "ok" | "err";
  error?: string;
  login?: string;
}

function logTrace(trace: TraceLog): void {
  const level = trace.status === "err" ? 50 : 30;
  const msg = trace.status === "err"
    ? `${trace.action} failed: ${trace.error}`
    : `${trace.action} completed`;

  // Pino-compatible structured JSON to stderr
  console.error(JSON.stringify({
    level,
    time: Date.now(),
    cat: "gui-cli",
    msg,
    correlationId: trace.correlationId,
    ...(trace.batchId ? { batchId: trace.batchId } : {}),
    ...(trace.login ? { login: trace.login } : {}),
    ms: trace.ms,
    status: trace.status,
    ...(trace.error ? { error: trace.error } : {}),
  }));
}
