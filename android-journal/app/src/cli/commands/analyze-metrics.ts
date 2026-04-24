/**
 * Metrics Command — Compute aggregate statistics from AuditLog
 *
 * The third pillar of observability. Logs tell you "what happened",
 * traces tell you "what path did it take", metrics tell you
 * "how is the system behaving over time".
 *
 * All metrics are computed from AuditLog — no separate metrics store needed.
 *
 * Usage:
 *   journal analyze metrics                 # full metrics report
 *   journal analyze metrics --last 1h       # last hour only
 */

import type { Command } from "commander";
import { prisma } from "@/lib/db";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

const ERROR_ACTIONS = ["access.denied", "system.error", "auth.failed"];

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function bar(value: number, max: number, width: number = 30): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return GREEN + "█".repeat(filled) + DIM + "░".repeat(width - filled) + RESET;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

export function registerMetricsCommand(analyze: Command): void {
  analyze
    .command("metrics")
    .description("Compute aggregate metrics from audit log")
    .option("--last <duration>", "Time window", "24h")
    .action(async (opts) => {
      const since = new Date(Date.now() - parseDuration(opts.last));

      // Fetch all events in window
      const events = await prisma.auditLog.findMany({
        where: { timestamp: { gte: since } },
        select: { action: true, timestamp: true, details: true, userId: true },
        orderBy: { timestamp: "asc" },
      });

      if (events.length === 0) {
        console.log(`No events in the last ${opts.last}`);
        return;
      }

      // ── Basic Counts ──────────────────────────────────
      const total = events.length;
      const errorCount = events.filter((e) => ERROR_ACTIONS.includes(e.action)).length;
      const traceEvents = events.filter((e) => e.action.startsWith("trace."));
      const businessEvents = events.filter((e) => !e.action.startsWith("trace."));
      const uniqueUsers = new Set(events.filter((e) => e.userId).map((e) => e.userId)).size;

      // ── Latency Metrics ───────────────────────────────
      const timings: { action: string; ms: number }[] = [];
      for (const e of traceEvents) {
        if (!e.details) continue;
        try {
          const det = JSON.parse(e.details);
          if (typeof det.ms === "number" && det.ms > 0) {
            timings.push({ action: e.action.replace("trace.", ""), ms: det.ms });
          }
        } catch { /* skip */ }
      }

      const allMs = timings.map((t) => t.ms).sort((a, b) => a - b);
      const p50 = percentile(allMs, 50);
      const p95 = percentile(allMs, 95);
      const p99 = percentile(allMs, 99);
      const avgMs = allMs.length ? Math.round(allMs.reduce((s, v) => s + v, 0) / allMs.length) : 0;

      // ── Per-Action Metrics ────────────────────────────
      const actionStats: Record<string, { count: number; totalMs: number; maxMs: number; errors: number; timings: number[] }> = {};
      for (const t of timings) {
        if (!actionStats[t.action]) actionStats[t.action] = { count: 0, totalMs: 0, maxMs: 0, errors: 0, timings: [] };
        actionStats[t.action].count++;
        actionStats[t.action].totalMs += t.ms;
        actionStats[t.action].maxMs = Math.max(actionStats[t.action].maxMs, t.ms);
        actionStats[t.action].timings.push(t.ms);
      }
      // Count errors per action
      for (const e of traceEvents) {
        if (!e.details) continue;
        try {
          const det = JSON.parse(e.details);
          const action = e.action.replace("trace.", "");
          if (det.status === "err" && actionStats[action]) {
            actionStats[action].errors++;
          }
        } catch { /* skip */ }
      }

      // ── Throughput (events per hour) ──────────────────
      const hours: Record<string, number> = {};
      for (const e of events) {
        const hour = e.timestamp.toISOString().slice(0, 13); // "2026-04-24T06"
        hours[hour] = (hours[hour] || 0) + 1;
      }
      const hourEntries = Object.entries(hours).sort();
      const maxPerHour = Math.max(...Object.values(hours));

      // ── Error Rate ────────────────────────────────────
      const errorRate = total > 0 ? ((errorCount / total) * 100).toFixed(1) : "0.0";

      // ── Print Report ──────────────────────────────────
      console.log(`${BOLD}Metrics — last ${opts.last}${RESET}`);
      console.log(`${DIM}${since.toISOString().replace("T", " ").slice(0, 19)} → now${RESET}\n`);

      // Overview
      console.log(`${BOLD}Overview${RESET}`);
      console.log(`  Total events:      ${total}`);
      console.log(`  Business events:   ${businessEvents.length}`);
      console.log(`  Trace events:      ${traceEvents.length}`);
      console.log(`  Errors:            ${errorCount > 0 ? RED + errorCount + RESET : GREEN + "0" + RESET}`);
      console.log(`  Error rate:        ${parseFloat(errorRate) > 5 ? RED : parseFloat(errorRate) > 1 ? YELLOW : GREEN}${errorRate}%${RESET}`);
      console.log(`  Active users:      ${uniqueUsers}`);

      // Latency
      if (allMs.length > 0) {
        console.log(`\n${BOLD}Latency${RESET}`);
        console.log(`  avg:    ${CYAN}${avgMs}ms${RESET}`);
        console.log(`  p50:    ${p50}ms`);
        console.log(`  p95:    ${p95 > 200 ? YELLOW : ""}${p95}ms${RESET}`);
        console.log(`  p99:    ${p99 > 500 ? RED : p99 > 200 ? YELLOW : ""}${p99}ms${RESET}`);
        console.log(`  max:    ${Math.max(...allMs)}ms`);
      }

      // Throughput sparkline
      if (hourEntries.length > 1) {
        console.log(`\n${BOLD}Throughput (events/hour)${RESET}`);
        for (const [hour, count] of hourEntries) {
          const label = hour.slice(11, 13) + ":00";
          console.log(`  ${DIM}${label}${RESET} ${bar(count, maxPerHour, 30)} ${count}`);
        }
      }

      // Per-action breakdown
      const sorted = Object.entries(actionStats)
        .sort((a, b) => b[1].count - a[1].count);

      if (sorted.length > 0) {
        console.log(`\n${BOLD}Per-Action Breakdown${RESET}`);
        console.log(`  ${"Action".padEnd(30)} ${"Count".padStart(5)} ${"Avg".padStart(6)} ${"p95".padStart(6)} ${"Max".padStart(6)} ${"Err".padStart(4)}`);
        console.log(`  ${DIM}${"─".repeat(30)} ${"─".repeat(5)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(6)} ${"─".repeat(4)}${RESET}`);
        for (const [action, stats] of sorted) {
          const avg = Math.round(stats.totalMs / stats.count);
          const sorted95 = [...stats.timings].sort((a, b) => a - b);
          const actionP95 = percentile(sorted95, 95);
          const errStr = stats.errors > 0 ? `${RED}${stats.errors}${RESET}` : `${DIM}0${RESET}`;
          console.log(`  ${action.padEnd(30)} ${String(stats.count).padStart(5)} ${String(avg + "ms").padStart(6)} ${String(actionP95 + "ms").padStart(6)} ${String(stats.maxMs + "ms").padStart(6)} ${errStr}`);
        }
      }

      await prisma.$disconnect();
    });
}
