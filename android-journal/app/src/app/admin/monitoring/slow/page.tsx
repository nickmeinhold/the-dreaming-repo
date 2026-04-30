/**
 * /admin/monitoring/slow — Slow Operations
 *
 * CLI equivalent: journal analyze slow
 * Shows trace events sorted by duration, highlighting slow ones.
 */

import { prisma } from "@/lib/db";

export default async function SlowPage() {
  // Get slowest trace events directly via durationMs column
  const withTiming = await prisma.auditLog.findMany({
    where: { action: { startsWith: "trace." }, durationMs: { gt: 0 } },
    orderBy: { durationMs: "desc" },
    take: 50,
  });

  const avgMs = withTiming.length ? Math.round(withTiming.reduce((s, e) => s + (e.durationMs ?? 0), 0) / withTiming.length) : 0;
  const slowCount = withTiming.filter((e) => (e.durationMs ?? 0) > 100).length;

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
          {withTiming.map((e) => {
            const det = parseDetails(e.details);
            const ms = e.durationMs ?? 0;
            return (
            <div key={e.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem", display: "flex", gap: "10px", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", fontSize: "0.75rem", minWidth: "55px" }}>
                {e.timestamp.toISOString().slice(11, 19)}
              </span>
              <span style={{
                fontWeight: "bold", minWidth: "60px", textAlign: "right",
                color: ms > 200 ? "#dc2626" : ms > 100 ? "#f59e0b" : "#059669",
              }}>
                {ms}ms
              </span>
              <span>{e.action.replace("trace.", "")}</span>
              <span style={{
                fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px",
                backgroundColor: e.status === "ok" ? "#d1fae5" : "#fee2e2",
                color: e.status === "ok" ? "#065f46" : "#991b1b",
              }}>
                {e.status}
              </span>
              {det.steps && (
                <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                  {det.steps.split(" → ").length} steps
                </span>
              )}
              {e.correlationId && (
                <a href={`/admin/monitoring/trace/${e.correlationId}`} style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.65rem", textDecoration: "none" }}>
                  {e.correlationId.slice(0, 8)}
                </a>
              )}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function parseDetails(d: string | null): { steps?: string; ms?: number; status?: string; error?: string } {
  if (!d) return {};
  try { const p = JSON.parse(d); return (p.steps && typeof p.steps === "string") ? p : {}; } catch { return {}; }
}
