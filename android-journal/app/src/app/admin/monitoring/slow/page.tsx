/**
 * /admin/monitoring/slow — Slow Operations
 *
 * CLI equivalent: journal analyze slow
 * Shows trace events sorted by duration, highlighting slow ones.
 */

import { prisma } from "@/lib/db";

export default async function SlowPage() {
  // Get all trace events, extract ms from details, sort by slowest
  const traceEvents = await prisma.auditLog.findMany({
    where: { action: { startsWith: "trace." } },
    orderBy: { timestamp: "desc" },
    take: 500, // scan recent traces
  });

  const withTiming = traceEvents
    .map((e) => {
      const det = parseDetails(e.details);
      return { ...e, ms: det.ms ?? 0, steps: det.steps, traceStatus: det.status, error: det.error };
    })
    .filter((e) => e.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 50);

  const avgMs = withTiming.length ? Math.round(withTiming.reduce((s, e) => s + e.ms, 0) / withTiming.length) : 0;
  const slowCount = withTiming.filter((e) => e.ms > 100).length;

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Slow Operations</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>
        {withTiming.length} traced operations — avg {avgMs}ms — {slowCount} over 100ms
      </p>

      {withTiming.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#059669", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No traced operations yet</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {withTiming.map((e) => (
            <div key={e.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem", display: "flex", gap: "10px", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.75rem", minWidth: "55px" }}>
                {e.timestamp.toISOString().slice(11, 19)}
              </span>
              <span style={{
                fontWeight: "bold", minWidth: "60px", textAlign: "right",
                color: e.ms > 200 ? "#dc2626" : e.ms > 100 ? "#f59e0b" : "#059669",
              }}>
                {e.ms}ms
              </span>
              <span>{e.action.replace("trace.", "")}</span>
              <span style={{
                fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px",
                backgroundColor: e.traceStatus === "ok" ? "#d1fae5" : "#fee2e2",
                color: e.traceStatus === "ok" ? "#065f46" : "#991b1b",
              }}>
                {e.traceStatus}
              </span>
              {e.steps && (
                <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                  {e.steps.split(" → ").length} steps
                </span>
              )}
              {e.correlationId && (
                <a href={`/admin/monitoring/trace/${e.correlationId}`} style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.65rem", textDecoration: "none" }}>
                  {e.correlationId.slice(0, 8)}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function parseDetails(d: string | null): { steps?: string; ms?: number; status?: string; error?: string } {
  if (!d) return {};
  try { const p = JSON.parse(d); return (p.steps && typeof p.steps === "string") ? p : {}; } catch { return {}; }
}
