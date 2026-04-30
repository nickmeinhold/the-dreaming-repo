/**
 * /admin/monitoring/metrics — System Metrics
 *
 * CLI equivalent: journal analyze metrics
 * The third pillar of observability: how is the system behaving over time?
 * Computed from AuditLog — no separate metrics store needed.
 */

import { prisma } from "@/lib/db";

const ERROR_ACTIONS = ["access.denied", "system.error", "auth.failed"];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ last?: string }>;
}) {
  const params = await searchParams;
  const lastHours = parseInt(params.last || "24", 10);
  const since = new Date(Date.now() - lastHours * 60 * 60 * 1000);

  const events = await prisma.auditLog.findMany({
    where: { timestamp: { gte: since } },
    select: { action: true, timestamp: true, details: true, userId: true, durationMs: true, status: true },
    orderBy: { timestamp: "asc" },
  });

  // ── Compute Metrics ──────────────────────────────────
  const total = events.length;
  const errorCount = events.filter((e) => ERROR_ACTIONS.includes(e.action)).length;
  const traceEvents = events.filter((e) => e.action.startsWith("trace."));
  const uniqueUsers = new Set(events.filter((e) => e.userId).map((e) => e.userId)).size;
  const errorRate = total > 0 ? ((errorCount / total) * 100).toFixed(1) : "0.0";

  // Extract timings from real columns (durationMs, status)
  const timings: { action: string; ms: number; status: string }[] = [];
  for (const e of traceEvents) {
    if (e.durationMs && e.durationMs > 0) {
      timings.push({
        action: e.action.replace("trace.", ""),
        ms: e.durationMs,
        status: e.status ?? "ok",
      });
    }
  }

  const allMs = timings.map((t) => t.ms).sort((a, b) => a - b);
  const p50 = percentile(allMs, 50);
  const p95 = percentile(allMs, 95);
  const p99 = percentile(allMs, 99);
  const avgMs = allMs.length ? Math.round(allMs.reduce((s, v) => s + v, 0) / allMs.length) : 0;
  const maxMs = allMs.length ? Math.max(...allMs) : 0;

  // Throughput per hour
  const hours: Record<string, number> = {};
  for (const e of events) {
    const hour = e.timestamp.toISOString().slice(0, 13);
    hours[hour] = (hours[hour] || 0) + 1;
  }
  const hourEntries = Object.entries(hours).sort();
  const maxPerHour = Math.max(...Object.values(hours), 1);

  // Per-action breakdown
  const actionStats: Record<string, { count: number; totalMs: number; maxMs: number; errors: number; timings: number[] }> = {};
  for (const t of timings) {
    if (!actionStats[t.action]) actionStats[t.action] = { count: 0, totalMs: 0, maxMs: 0, errors: 0, timings: [] };
    actionStats[t.action].count++;
    actionStats[t.action].totalMs += t.ms;
    actionStats[t.action].maxMs = Math.max(actionStats[t.action].maxMs, t.ms);
    actionStats[t.action].timings.push(t.ms);
    if (t.status === "err") actionStats[t.action].errors++;
  }
  const sortedActions = Object.entries(actionStats).sort((a, b) => b[1].count - a[1].count);

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", margin: 0 }}>Metrics</h2>
        <div style={{ display: "flex", gap: "4px" }}>
          {[1, 6, 24, 168].map((h) => (
            <a key={h} href={`/admin/monitoring/metrics?last=${h}`}
              style={{
                padding: "3px 8px", borderRadius: "10px", fontSize: "0.75rem", textDecoration: "none",
                color: lastHours === h ? "#fff" : "#374151",
                backgroundColor: lastHours === h ? "#6b7280" : "#f3f4f6",
                border: "1px solid #d1d5db",
              }}>
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </a>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        <Stat label="Events" value={String(total)} />
        <Stat label="Errors" value={String(errorCount)} color={errorCount > 0 ? "#dc2626" : "#059669"} />
        <Stat label="Error Rate" value={`${errorRate}%`} color={parseFloat(errorRate) > 5 ? "#dc2626" : parseFloat(errorRate) > 1 ? "#f59e0b" : "#059669"} />
        <Stat label="Users" value={String(uniqueUsers)} />
        <Stat label="Traces" value={String(timings.length)} />
        <Stat label="Avg Latency" value={`${avgMs}ms`} color={avgMs > 200 ? "#f59e0b" : undefined} />
      </div>

      {/* Latency Percentiles */}
      {allMs.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>Latency Percentiles</h3>
          <div style={{ display: "flex", gap: "2rem", padding: "1rem", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <LatencyBar label="p50" value={p50} max={maxMs} />
            <LatencyBar label="p95" value={p95} max={maxMs} />
            <LatencyBar label="p99" value={p99} max={maxMs} />
            <LatencyBar label="max" value={maxMs} max={maxMs} />
          </div>
        </div>
      )}

      {/* Throughput chart */}
      {hourEntries.length > 1 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>Throughput (events/hour)</h3>
          <div style={{ display: "flex", alignItems: "end", gap: "2px", height: "100px", padding: "0.5rem", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            {hourEntries.map(([hour, count]) => {
              const height = Math.max(4, (count / maxPerHour) * 90);
              return (
                <div key={hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "end", height: "100%" }}>
                  <div style={{
                    width: "100%",
                    height: `${height}%`,
                    backgroundColor: "#3b82f6",
                    borderRadius: "2px 2px 0 0",
                    minHeight: "4px",
                  }} title={`${hour.slice(11)}:00 — ${count} events`} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#9ca3af", marginTop: "2px" }}>
            <span>{hourEntries[0][0].slice(11)}:00</span>
            <span>{hourEntries[hourEntries.length - 1][0].slice(11)}:00</span>
          </div>
        </div>
      )}

      {/* Per-Action Table */}
      {sortedActions.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>Per-Action Breakdown</h3>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr repeat(5, 1fr)", padding: "8px 12px", backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: "0.7rem", fontWeight: "bold", color: "#6b7280" }}>
              <span>Action</span>
              <span style={{ textAlign: "right" }}>Count</span>
              <span style={{ textAlign: "right" }}>Avg</span>
              <span style={{ textAlign: "right" }}>p95</span>
              <span style={{ textAlign: "right" }}>Max</span>
              <span style={{ textAlign: "right" }}>Errors</span>
            </div>
            {sortedActions.map(([action, stats]) => {
              const avg = Math.round(stats.totalMs / stats.count);
              const s95 = percentile([...stats.timings].sort((a, b) => a - b), 95);
              return (
                <div key={action} style={{ display: "grid", gridTemplateColumns: "2fr repeat(5, 1fr)", padding: "6px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem" }}>
                  <span style={{ fontFamily: "monospace" }}>{action}</span>
                  <span style={{ textAlign: "right" }}>{stats.count}</span>
                  <span style={{ textAlign: "right", color: avg > 200 ? "#f59e0b" : "#374151" }}>{avg}ms</span>
                  <span style={{ textAlign: "right", color: s95 > 200 ? "#f59e0b" : "#374151" }}>{s95}ms</span>
                  <span style={{ textAlign: "right", color: stats.maxMs > 300 ? "#dc2626" : "#374151" }}>{stats.maxMs}ms</span>
                  <span style={{ textAlign: "right", color: stats.errors > 0 ? "#dc2626" : "#9ca3af" }}>{stats.errors}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {total === 0 && (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          No events in the last {lastHours}h. Metrics will appear as users interact with the journal.
        </div>
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: color ?? "#111827" }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: "#6b7280", marginTop: "0.15rem" }}>{label}</div>
    </div>
  );
}

function LatencyBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  const color = value > 300 ? "#dc2626" : value > 100 ? "#f59e0b" : "#059669";
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "4px" }}>{label}</div>
      <div style={{ height: "60px", display: "flex", alignItems: "end", justifyContent: "center" }}>
        <div style={{ width: "40px", height: `${pct}%`, backgroundColor: color, borderRadius: "4px 4px 0 0" }} />
      </div>
      <div style={{ fontSize: "0.85rem", fontWeight: "bold", color, marginTop: "4px" }}>{value}ms</div>
    </div>
  );
}
