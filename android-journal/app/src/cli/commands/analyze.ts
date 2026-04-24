/**
 * Log Analyzer — Purpose-Built Debugging Tool
 *
 * Reads Pino JSON log files and answers debugging questions.
 * Works even when the database is down (reads files, not DB).
 *
 * Usage:
 *   journal analyze errors                   # what went wrong?
 *   journal analyze errors --last 1h         # in the last hour?
 *   journal analyze trace <correlationId>    # full trace for one request
 *   journal analyze slow                     # what's slow?
 *   journal analyze timeline --last 30m      # what happened, in order?
 *   journal analyze summary                  # overview
 *   journal analyze user <userId>            # what did this user do?
 *   journal analyze requests --status 500    # failed HTTP requests
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";

// ── Types ──────────────────────────────────────────────────

interface LogLine {
  level: number;
  time: number;
  msg: string;
  cat?: string;
  correlationId?: string;
  userId?: number | null;
  // trace fields
  trace?: {
    action: string;
    ms: number;
    status: string;
    steps: { name: string; status: string; ms: number; error?: string }[];
    error?: string;
  };
  // route fields
  method?: string;
  path?: string;
  status?: number;
  ms?: number;
  ip?: string;
  // db fields
  model?: string;
  operation?: string;
  // search fields
  query?: string;
  results?: number;
  // error fields
  err?: { type?: string; message?: string; stack?: string };
  route?: string;
  detail?: string;
}

// ── Helpers ────────────────────────────────────────────────

const LEVEL_NAMES: Record<number, string> = {
  10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL",
};

const LEVEL_COLORS: Record<number, string> = {
  30: "\x1b[32m",  // green
  40: "\x1b[33m",  // yellow
  50: "\x1b[31m",  // red
  60: "\x1b[35m",  // magenta
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function formatTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(11, 19);
}

function readLogFile(filePath: string, since: number): LogLine[] {
  if (!existsSync(filePath)) {
    console.error(`Log file not found: ${filePath}`);
    console.error(`Set LOG_DIR=logs and restart the server, or specify --file`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf-8");
  const lines: LogLine[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LogLine;
      if (parsed.time && parsed.time >= since) {
        lines.push(parsed);
      }
    } catch {
      // Skip non-JSON lines (e.g. pino-pretty output mixed in)
    }
  }

  return lines;
}

function logPath(name: "access" | "error" | "event"): string {
  const dir = process.env.LOG_DIR || "logs";
  return join(process.cwd(), dir, `${name}.log`);
}

// ── Commands ───────────────────────────────────────────────

import { registerMetricsCommand } from "@/cli/commands/analyze-metrics";

export function registerAnalyzeCommand(program: Command): void {
  const analyze = program.command("analyze").description("Analyze log files");

  // Register metrics subcommand (lives in separate file for clarity)
  registerMetricsCommand(analyze);

  // ── errors ──────────────────────────────────────────────
  analyze
    .command("errors")
    .description("Show errors and warnings from the log")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "24h")
    .option("--limit <n>", "Max results", "50")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("error");
      const limit = parseInt(opts.limit, 10);
      const lines = readLogFile(file, since);

      const errors = lines
        .filter((l) => l.level >= 40)
        .slice(-limit);

      if (errors.length === 0) {
        console.log(`${GREEN}No errors in the last ${opts.last}${RESET}`);
        return;
      }

      console.log(`${BOLD}${errors.length} error(s) in the last ${opts.last}${RESET}\n`);

      for (const e of errors) {
        const color = LEVEL_COLORS[e.level] || "";
        const level = LEVEL_NAMES[e.level] || String(e.level);
        const time = formatTime(e.time);

        console.log(`${DIM}${time}${RESET} ${color}${level}${RESET} ${e.msg}`);

        if (e.trace) {
          const steps = e.trace.steps
            .map((s) => s.status === "err" ? `${RED}${s.name}${RESET}` : `${DIM}${s.name}${RESET}`)
            .join(" → ");
          console.log(`         ${steps}`);
          if (e.trace.error) console.log(`         ${RED}${e.trace.error}${RESET}`);
        }

        if (e.err?.message && !e.trace) {
          console.log(`         ${RED}${e.err.message}${RESET}`);
        }

        if (e.correlationId) {
          console.log(`         ${DIM}corr: ${e.correlationId}${RESET}`);
        }
        console.log();
      }
    });

  // ── trace ───────────────────────────────────────────────
  analyze
    .command("trace <correlationId>")
    .description("Show all log entries for a single request")
    .option("--file <path>", "Log file path")
    .action((correlationId, opts) => {
      const file = opts.file || logPath("event");
      const lines = readLogFile(file, 0); // no time filter — search all

      const matching = lines.filter((l) => l.correlationId === correlationId);

      if (matching.length === 0) {
        console.log(`No log entries found for correlationId: ${correlationId}`);
        console.log(`${DIM}Tip: correlationIds are in audit log rows — try: journal logs --last 24h${RESET}`);
        return;
      }

      console.log(`${BOLD}Trace: ${correlationId}${RESET}`);
      console.log(`${DIM}${matching.length} log entries${RESET}\n`);

      for (const e of matching) {
        const time = formatTime(e.time);
        const level = LEVEL_NAMES[e.level] || String(e.level);
        const color = LEVEL_COLORS[e.level] || "";

        console.log(`${DIM}${time}${RESET} ${color}${level}${RESET} ${e.cat ? `[${e.cat}] ` : ""}${e.msg}`);

        if (e.trace) {
          for (const step of e.trace.steps) {
            const icon = step.status === "ok" ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
            const ms = step.ms > 0 ? ` ${DIM}${step.ms}ms${RESET}` : "";
            const err = step.error ? ` ${RED}${step.error}${RESET}` : "";
            console.log(`         ${icon} ${step.name}${ms}${err}`);
          }
        }
      }
    });

  // ── slow ────────────────────────────────────────────────
  analyze
    .command("slow")
    .description("Show slow operations")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "24h")
    .option("--threshold <ms>", "Minimum ms to report", "100")
    .option("--limit <n>", "Max results", "20")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("event");
      const threshold = parseInt(opts.threshold, 10);
      const limit = parseInt(opts.limit, 10);
      const lines = readLogFile(file, since);

      const slow: { time: number; action: string; ms: number; status: string; corr?: string }[] = [];

      for (const l of lines) {
        // Trace entries
        if (l.trace && l.trace.ms >= threshold) {
          slow.push({
            time: l.time,
            action: l.trace.action,
            ms: l.trace.ms,
            status: l.trace.status,
            corr: l.correlationId,
          });
        }
        // Route entries
        if (l.ms && l.ms >= threshold && l.method && l.path) {
          slow.push({
            time: l.time,
            action: `${l.method} ${l.path}`,
            ms: l.ms,
            status: String(l.status || "?"),
            corr: l.correlationId,
          });
        }
      }

      slow.sort((a, b) => b.ms - a.ms);
      const top = slow.slice(0, limit);

      if (top.length === 0) {
        console.log(`${GREEN}Nothing slower than ${threshold}ms in the last ${opts.last}${RESET}`);
        return;
      }

      console.log(`${BOLD}${top.length} slow operation(s) (>${threshold}ms) in the last ${opts.last}${RESET}\n`);

      for (const s of top) {
        const time = formatTime(s.time);
        const color = s.ms > 500 ? RED : s.ms > 200 ? YELLOW : "";
        console.log(`${DIM}${time}${RESET} ${color}${String(s.ms).padStart(6)}ms${RESET} ${s.action} ${DIM}[${s.status}]${RESET}`);
      }
    });

  // ── timeline ────────────────────────────────────────────
  analyze
    .command("timeline")
    .description("Chronological timeline of events")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "30m")
    .option("--cat <category>", "Filter by category")
    .option("--limit <n>", "Max entries", "100")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("event");
      const limit = parseInt(opts.limit, 10);
      let lines = readLogFile(file, since);

      if (opts.cat) {
        lines = lines.filter((l) => l.cat === opts.cat);
      }

      const entries = lines.slice(-limit);

      if (entries.length === 0) {
        console.log(`No events in the last ${opts.last}${opts.cat ? ` for category '${opts.cat}'` : ""}`);
        return;
      }

      console.log(`${BOLD}Timeline: last ${opts.last}${opts.cat ? ` [${opts.cat}]` : ""}${RESET}`);
      console.log(`${DIM}${entries.length} entries${RESET}\n`);

      for (const e of entries) {
        const time = formatTime(e.time);
        const color = LEVEL_COLORS[e.level] || "";
        const cat = e.cat ? `${CYAN}[${e.cat}]${RESET} ` : "";
        const user = e.userId ? `${DIM}user:${e.userId}${RESET} ` : "";

        let summary = e.msg;
        if (e.trace) {
          const stepSummary = e.trace.steps
            .map((s) => s.status === "err" ? `${RED}${s.name}${RESET}` : s.name)
            .join("→");
          summary = `${e.trace.action} ${e.trace.status === "ok" ? GREEN : RED}${e.trace.status}${RESET} ${e.trace.ms}ms [${stepSummary}]`;
        }

        console.log(`${DIM}${time}${RESET} ${color}${(LEVEL_NAMES[e.level] || "").padEnd(5)}${RESET} ${cat}${user}${summary}`);
      }
    });

  // ── summary ─────────────────────────────────────────────
  analyze
    .command("summary")
    .description("Overview of log activity")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "24h")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("event");
      const lines = readLogFile(file, since);

      if (lines.length === 0) {
        console.log(`No log entries in the last ${opts.last}`);
        return;
      }

      // Counts by level
      const byCat: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      const users = new Set<number>();
      let errors = 0;
      let warnings = 0;
      let traces = 0;
      let requests = 0;
      let totalMs = 0;
      let slowest = { action: "", ms: 0 };

      for (const l of lines) {
        if (l.level >= 50) errors++;
        if (l.level === 40) warnings++;
        if (l.cat) byCat[l.cat] = (byCat[l.cat] || 0) + 1;
        if (l.userId) users.add(l.userId);

        if (l.trace) {
          traces++;
          byAction[l.trace.action] = (byAction[l.trace.action] || 0) + 1;
          totalMs += l.trace.ms;
          if (l.trace.ms > slowest.ms) {
            slowest = { action: l.trace.action, ms: l.trace.ms };
          }
        }

        if (l.method && l.path) requests++;
      }

      const timeRange = lines.length > 1
        ? `${formatTime(lines[0].time)} → ${formatTime(lines[lines.length - 1].time)}`
        : formatTime(lines[0].time);

      console.log(`${BOLD}Log Summary — last ${opts.last}${RESET}`);
      console.log(`${DIM}${timeRange}${RESET}\n`);

      console.log(`  Total entries:  ${lines.length}`);
      console.log(`  HTTP requests:  ${requests}`);
      console.log(`  Action traces:  ${traces}`);
      console.log(`  Active users:   ${users.size}`);
      console.log(`  Errors:         ${errors > 0 ? `${RED}${errors}${RESET}` : GREEN + "0" + RESET}`);
      console.log(`  Warnings:       ${warnings > 0 ? `${YELLOW}${warnings}${RESET}` : "0"}`);

      if (traces > 0) {
        console.log(`  Avg action ms:  ${Math.round(totalMs / traces)}`);
        console.log(`  Slowest:        ${slowest.action} (${slowest.ms}ms)`);
      }

      // By category
      const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
      if (catEntries.length > 0) {
        console.log(`\n${BOLD}By Category${RESET}`);
        for (const [cat, count] of catEntries) {
          const bar = "█".repeat(Math.min(Math.round(count / lines.length * 40), 40));
          console.log(`  ${cat.padEnd(12)} ${String(count).padStart(5)}  ${DIM}${bar}${RESET}`);
        }
      }

      // Top actions
      const actionEntries = Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (actionEntries.length > 0) {
        console.log(`\n${BOLD}Top Actions${RESET}`);
        for (const [action, count] of actionEntries) {
          console.log(`  ${action.padEnd(25)} ${count}`);
        }
      }
    });

  // ── user ────────────────────────────────────────────────
  analyze
    .command("user <userId>")
    .description("Show all activity for a user ID")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "24h")
    .option("--limit <n>", "Max results", "50")
    .action((userId, opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("event");
      const uid = parseInt(userId, 10);
      const limit = parseInt(opts.limit, 10);
      const lines = readLogFile(file, since);

      const matching = lines.filter((l) => l.userId === uid).slice(-limit);

      if (matching.length === 0) {
        console.log(`No activity for user ${uid} in the last ${opts.last}`);
        return;
      }

      console.log(`${BOLD}User ${uid} — ${matching.length} entries in the last ${opts.last}${RESET}\n`);

      for (const e of matching) {
        const time = formatTime(e.time);
        const cat = e.cat ? `${CYAN}[${e.cat}]${RESET} ` : "";
        console.log(`${DIM}${time}${RESET} ${cat}${e.msg}`);
      }
    });

  // ── requests ────────────────────────────────────────────
  analyze
    .command("requests")
    .description("Show HTTP requests")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "1h")
    .option("--status <code>", "Filter by status code prefix (e.g. 5, 4, 500)")
    .option("--path <prefix>", "Filter by path prefix (e.g. /api, /papers)")
    .option("--api", "Shorthand for --path /api")
    .option("--limit <n>", "Max results", "50")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("access");
      const limit = parseInt(opts.limit, 10);
      const lines = readLogFile(file, since);

      let reqs = lines.filter((l) => l.method && l.path);

      if (opts.api) {
        reqs = reqs.filter((l) => l.path?.startsWith("/api"));
      } else if (opts.path) {
        reqs = reqs.filter((l) => l.path?.startsWith(opts.path));
      }

      if (opts.status) {
        const prefix = opts.status;
        reqs = reqs.filter((l) => String(l.status || "").startsWith(prefix));
      }

      const entries = reqs.slice(-limit);

      if (entries.length === 0) {
        console.log(`No requests${opts.status ? ` with status ${opts.status}xx` : ""} in the last ${opts.last}`);
        return;
      }

      console.log(`${BOLD}${entries.length} request(s) in the last ${opts.last}${RESET}\n`);

      for (const e of entries) {
        const time = formatTime(e.time);
        const status = e.status || 0;
        const color = status >= 500 ? RED : status >= 400 ? YELLOW : GREEN;
        console.log(
          `${DIM}${time}${RESET} ${(e.method || "?").padEnd(4)} ${(e.path || "?").padEnd(35)} ${color}${status}${RESET} ${DIM}${e.ms || 0}ms${RESET}${e.ip ? ` ${DIM}${e.ip}${RESET}` : ""}`,
        );
      }
    });

  // ── db ──────────────────────────────────────────────────
  analyze
    .command("db")
    .description("Show database query logs (timing, errors, slow queries)")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "1h")
    .option("--slow", "Show only slow queries (>100ms)")
    .option("--errors", "Show only failed queries")
    .option("--model <model>", "Filter by model (e.g. Paper, User, Review)")
    .option("--limit <n>", "Max results", "50")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const file = opts.file || logPath("event");
      const limit = parseInt(opts.limit, 10);
      const lines = readLogFile(file, since);

      let queries = lines.filter((l) => l.cat === "db" && l.model);

      if (opts.slow) {
        queries = queries.filter((l) => (l.ms ?? 0) > 100);
      }
      if (opts.errors) {
        queries = queries.filter((l) => l.level >= 50);
      }
      if (opts.model) {
        const m = opts.model.toLowerCase();
        queries = queries.filter((l) => (l.model ?? "").toLowerCase() === m);
      }

      const entries = queries.slice(-limit);

      if (entries.length === 0) {
        console.log(`${GREEN}No DB queries${opts.slow ? " >100ms" : ""}${opts.errors ? " failures" : ""} in the last ${opts.last}${RESET}`);
        return;
      }

      // Summary stats
      const totalMs = queries.reduce((sum, l) => sum + (l.ms ?? 0), 0);
      const avgMs = queries.length ? Math.round(totalMs / queries.length) : 0;
      const maxMs = Math.max(...queries.map((l) => l.ms ?? 0));
      const failCount = queries.filter((l) => l.level >= 50).length;

      console.log(`${BOLD}DB queries — last ${opts.last}${RESET}`);
      console.log(`${DIM}${queries.length} queries, avg ${avgMs}ms, max ${maxMs}ms${failCount ? `, ${RED}${failCount} failed${RESET}` : ""}${RESET}\n`);

      for (const e of entries) {
        const time = formatTime(e.time);
        const ms = e.ms ?? 0;
        const color = e.level >= 50 ? RED : ms > 100 ? YELLOW : ms > 50 ? "" : DIM;
        const status = e.level >= 50 ? ` ${RED}FAILED${RESET}` : "";
        console.log(`${DIM}${time}${RESET} ${color}${String(ms).padStart(5)}ms${RESET} ${e.model}.${e.operation}${status}`);
        if (e.level >= 50 && (e as LogLine & { error?: string }).error) {
          console.log(`         ${RED}${(e as LogLine & { error?: string }).error}${RESET}`);
        }
      }
    });

  // ── auth ────────────────────────────────────────────────
  analyze
    .command("auth")
    .description("Show authentication events (logins, failures, logouts)")
    .option("--file <path>", "Log file path")
    .option("--last <duration>", "Time window", "24h")
    .option("--failures", "Show only failures")
    .option("--limit <n>", "Max results", "50")
    .action((opts) => {
      const since = Date.now() - parseDuration(opts.last);
      const limit = parseInt(opts.limit, 10);

      // Read from event log (traces) and access log (auth endpoints)
      const eventFile = opts.file || logPath("event");
      const accessFile = logPath("access");

      const eventLines = existsSync(eventFile) ? readLogFile(eventFile, since) : [];
      const accessLines = existsSync(accessFile) ? readLogFile(accessFile, since) : [];

      // Auth traces (login callbacks, access denied)
      const authTraces = eventLines.filter((l) =>
        l.cat === "auth" ||
        l.trace?.action?.startsWith("auth.") ||
        l.msg?.includes("access.denied") ||
        l.msg?.includes("auth."),
      );

      // Auth-related HTTP requests (login, logout, callback)
      const authRequests = accessLines.filter((l) =>
        l.path?.startsWith("/api/auth"),
      );

      // Merge and sort by time
      let all = [...authTraces, ...authRequests].sort((a, b) => a.time - b.time);

      if (opts.failures) {
        all = all.filter((l) => l.level >= 40 || l.trace?.status === "err" || (l.status && l.status >= 400));
      }

      const entries = all.slice(-limit);

      if (entries.length === 0) {
        console.log(`${GREEN}No auth events${opts.failures ? " failures" : ""} in the last ${opts.last}${RESET}`);
        return;
      }

      console.log(`${BOLD}Auth activity — last ${opts.last}${opts.failures ? " (failures only)" : ""}${RESET}`);
      console.log(`${DIM}${entries.length} events${RESET}\n`);

      for (const e of entries) {
        const time = formatTime(e.time);
        const color = LEVEL_COLORS[e.level] || "";
        const level = (LEVEL_NAMES[e.level] || "").padEnd(5);

        if (e.trace) {
          const icon = e.trace.status === "ok" ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
          const steps = e.trace.steps
            .map((s) => s.status === "err" ? `${RED}${s.name}${RESET}` : `${DIM}${s.name}${RESET}`)
            .join(" → ");
          console.log(`${DIM}${time}${RESET} ${icon} ${e.trace.action} ${DIM}${e.trace.ms}ms${RESET}`);
          console.log(`         ${steps}`);
          if (e.trace.error) console.log(`         ${RED}${e.trace.error}${RESET}`);
        } else if (e.method && e.path) {
          const statusColor = (e.status || 0) >= 400 ? RED : GREEN;
          console.log(`${DIM}${time}${RESET} ${(e.method || "").padEnd(4)} ${e.path} ${statusColor}${e.status}${RESET} ${DIM}${e.ip || ""}${RESET}`);
        } else {
          console.log(`${DIM}${time}${RESET} ${color}${level}${RESET} ${e.msg}`);
        }
      }
    });
}
