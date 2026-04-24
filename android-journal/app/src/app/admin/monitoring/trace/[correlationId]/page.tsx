/**
 * /admin/monitoring/trace/[correlationId] — Single Request Trace
 *
 * CLI equivalent: journal analyze trace <correlationId>
 * Shows every audit event with this correlationId, with step flows.
 */

import { prisma } from "@/lib/db";

export default async function TracePage({
  params,
}: {
  params: Promise<{ correlationId: string }>;
}) {
  const { correlationId } = await params;

  const events = await prisma.auditLog.findMany({
    where: { correlationId },
    orderBy: { timestamp: "asc" },
  });

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Trace</h2>
      <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "1.5rem", fontFamily: "monospace" }}>
        {correlationId}
      </p>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          No events found for this correlationId.
          <br /><span style={{ fontSize: "0.8rem" }}>Traces are stored when actions run through the web app. CLI commands don't produce traces.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {events.map((e) => {
            const det = parseDetails(e.details);
            const isTrace = det.steps !== undefined;
            return (
              <div key={e.id} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "14px", backgroundColor: "#fff" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: isTrace ? "10px" : 0 }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
                    {e.timestamp.toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                  <span style={{
                    padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold",
                    color: "#fff", backgroundColor: e.action.includes("error") || e.action.includes("failed") || e.action.includes("denied") ? "#dc2626" : "#3b82f6",
                  }}>
                    {e.action}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>{e.entity}:{e.entityId}</span>
                  {det.ms !== undefined && (
                    <span style={{ fontSize: "0.8rem", color: det.ms > 100 ? "#f59e0b" : "#9ca3af", marginLeft: "auto" }}>
                      {det.ms}ms
                    </span>
                  )}
                </div>

                {/* Step flow */}
                {det.steps && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", paddingLeft: "12px", borderLeft: "2px solid #e5e7eb" }}>
                    {det.steps.split(" → ").map((step, i) => {
                      const [name, status] = step.split(":");
                      const isErr = status === "err";
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem" }}>
                          <span style={{ color: isErr ? "#dc2626" : "#059669", fontSize: "0.9rem" }}>
                            {isErr ? "✗" : "✓"}
                          </span>
                          <span style={{ color: isErr ? "#dc2626" : "#374151", fontWeight: isErr ? "bold" : "normal" }}>
                            {name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Error message */}
                {det.error && (
                  <div style={{ marginTop: "8px", padding: "6px 10px", backgroundColor: "#fef2f2", borderRadius: "4px", color: "#dc2626", fontSize: "0.8rem" }}>
                    {det.error}
                  </div>
                )}

                {/* Non-trace details */}
                {!isTrace && e.details && (
                  <div style={{ marginTop: "6px", fontSize: "0.8rem", color: "#6b7280" }}>{e.details}</div>
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
  try {
    const p = JSON.parse(d);
    return (p.steps && typeof p.steps === "string") ? p : {};
  } catch { return {}; }
}
