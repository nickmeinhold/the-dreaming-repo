/**
 * /admin/monitoring/db — Database Activity
 *
 * CLI equivalent: journal analyze db
 * Shows trace events with step-level DB timing extracted from traces.
 */

import { prisma } from "@/lib/db";

export default async function DbPage() {
  // Get trace events and extract DB-related steps
  const traceEvents = await prisma.auditLog.findMany({
    where: { action: { startsWith: "trace." } },
    orderBy: { timestamp: "desc" },
    take: 500,
  });

  const dbOps: { time: Date; action: string; step: string; ms: number; status: string; correlationId: string | null }[] = [];

  for (const e of traceEvents) {
    const det = parseDetails(e.details);
    if (!det.steps) continue;

    for (const stepStr of det.steps.split(" → ")) {
      const [name, status] = stepStr.split(":");
      // DB-related steps contain "db-", "lookup", "create", "update", "upsert", "check", "transition"
      if (name.includes("db-") || name.includes("lookup") || name.includes("create") || name.includes("update") || name.includes("upsert") || name === "transition") {
        dbOps.push({
          time: e.timestamp,
          action: e.action.replace("trace.", ""),
          step: name,
          ms: 0, // individual step ms not available from summary string
          status,
          correlationId: e.correlationId,
        });
      }
    }
  }

  // Also show overall trace timing for DB-heavy operations
  const dbTraces = traceEvents
    .filter((e) => e.durationMs != null && e.durationMs > 0)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 50);

  const totalOps = dbOps.length;
  const failedOps = dbOps.filter((o) => o.status === "err").length;

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Database Activity</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>
        {totalOps} DB operations from recent traces{failedOps > 0 && <span style={{ color: "#dc2626" }}> — {failedOps} failed</span>}
      </p>

      {/* DB step breakdown */}
      {(() => {
        const stepCounts: Record<string, { total: number; failed: number }> = {};
        for (const op of dbOps) {
          if (!stepCounts[op.step]) stepCounts[op.step] = { total: 0, failed: 0 };
          stepCounts[op.step].total++;
          if (op.status === "err") stepCounts[op.step].failed++;
        }
        const sorted = Object.entries(stepCounts).sort((a, b) => b[1].total - a[1].total);

        return sorted.length > 0 ? (
          <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            {sorted.map(([step, { total, failed }]) => (
              <div key={step} style={{
                padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "8px",
                backgroundColor: failed > 0 ? "#fef2f2" : "#fff", textAlign: "center",
              }}>
                <div style={{ fontWeight: "bold", fontSize: "1.1rem", color: failed > 0 ? "#dc2626" : "#374151" }}>{total}</div>
                <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>{step}</div>
                {failed > 0 && <div style={{ fontSize: "0.65rem", color: "#dc2626" }}>{failed} failed</div>}
              </div>
            ))}
          </div>
        ) : null;
      })()}

      {/* Traces sorted by duration */}
      <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Traces by Duration</h3>
      {dbTraces.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No traces yet</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {dbTraces.map((e) => {
            const det = parseDetails(e.details);
            const ms = e.durationMs ?? 0;
            return (
            <div key={e.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem", display: "flex", gap: "10px", alignItems: "center" }}>
              <span style={{ color: "#9ca3af", minWidth: "55px" }}>{e.timestamp.toISOString().slice(11, 19)}</span>
              <span style={{
                fontWeight: "bold", minWidth: "50px", textAlign: "right",
                color: ms > 200 ? "#dc2626" : ms > 100 ? "#f59e0b" : "#059669",
              }}>
                {ms}ms
              </span>
              <span>{e.action.replace("trace.", "")}</span>
              {det.steps && (
                <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                  {det.steps.split(" → ").map((s: string, i: number) => {
                    const [name, status] = s.split(":");
                    return <span key={i}>{i > 0 && " → "}<span style={{ color: status === "err" ? "#dc2626" : "#9ca3af" }}>{name}</span></span>;
                  })}
                </span>
              )}
              {e.correlationId && (
                <a href={`/admin/monitoring/trace/${e.correlationId}`} style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.65rem", textDecoration: "none" }}>{e.correlationId.slice(0, 8)}</a>
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
