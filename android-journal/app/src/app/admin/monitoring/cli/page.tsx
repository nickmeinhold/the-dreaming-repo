/**
 * /admin/monitoring/cli — CLI Command Activity
 *
 * Shows every CLI command execution with trace steps.
 * CLI traces have actions like trace.cli.paper.submit, trace.cli.editorial.status, etc.
 */

import { prisma } from "@/lib/db";

export default async function CliPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const perPage = 50;

  const where = { action: { startsWith: "trace.cli." } };

  const [events, totalCount, commandCounts] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: perPage,
      skip: (currentPage - 1) * perPage,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where,
      _count: true,
      orderBy: { _count: { action: "desc" } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>CLI Activity</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>{totalCount} CLI commands executed</p>

      {/* Command breakdown */}
      {commandCounts.length > 0 && (
        <div style={{ display: "flex", gap: "4px", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {commandCounts.map(({ action, _count }) => (
            <span key={action} style={{
              padding: "3px 8px", borderRadius: "10px", fontSize: "0.7rem",
              backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151",
            }}>
              {action.replace("trace.cli.", "")} ({_count})
            </span>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          No CLI commands recorded yet.
          <br /><span style={{ fontSize: "0.8rem" }}>CLI traces appear when commands run with LOG_LEVEL=info (not silent).</span>
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {events.map((e) => {
            const det = parseDetails(e.details);
            const command = e.action.replace("trace.cli.", "");
            const rowStyle = { padding: "10px 14px", borderBottom: "1px solid #f3f4f6" };
            const inner = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.85rem" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.8rem", minWidth: "145px" }}>
                    {e.timestamp.toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                  <span style={{ fontFamily: "monospace", fontWeight: "bold", color: "#374151" }}>
                    $ journal {command.replace(/\./g, " ")}
                  </span>
                  {det.status && (
                    <span style={{
                      fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px",
                      backgroundColor: det.status === "ok" ? "#d1fae5" : "#fee2e2",
                      color: det.status === "ok" ? "#065f46" : "#991b1b",
                    }}>
                      {det.status}
                    </span>
                  )}
                  {det.ms !== undefined && (
                    <span style={{ fontSize: "0.75rem", color: det.ms > 100 ? "#f59e0b" : "#9ca3af" }}>
                      {det.ms}ms
                    </span>
                  )}
                  {e.userId && <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>user:{e.userId}</span>}
                </div>

                {/* Step flow */}
                {det.steps && (
                  <div style={{ marginTop: "4px", paddingLeft: "155px", fontSize: "0.75rem" }}>
                    {det.steps.split(" → ").map((step: string, i: number) => {
                      const [name, status] = step.split(":");
                      return (
                        <span key={i}>
                          {i > 0 && <span style={{ color: "#d1d5db" }}> → </span>}
                          <span style={{ color: status === "err" ? "#dc2626" : "#059669", fontWeight: status === "err" ? "bold" : "normal" }}>
                            {name}
                          </span>
                        </span>
                      );
                    })}
                    {det.error && <span style={{ color: "#dc2626", marginLeft: "8px" }}>({det.error})</span>}
                  </div>
                )}
              </>
            );
            return e.correlationId ? (
              <a key={e.id} href={`/admin/monitoring/trace/${e.correlationId}`} style={{ ...rowStyle, display: "block", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
                {inner}
              </a>
            ) : (
              <div key={e.id} style={rowStyle}>
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1.5rem" }}>
          {currentPage > 1 && <a href={`/admin/monitoring/cli?page=${currentPage - 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Prev</a>}
          <span style={{ padding: "4px 12px", color: "#6b7280" }}>{currentPage}/{totalPages}</span>
          {currentPage < totalPages && <a href={`/admin/monitoring/cli?page=${currentPage + 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Next</a>}
        </div>
      )}
    </>
  );
}

function parseDetails(d: string | null): { steps?: string; ms?: number; status?: string; error?: string } {
  if (!d) return {};
  try { const p = JSON.parse(d); return (p.steps && typeof p.steps === "string") ? p : {}; } catch { return {}; }
}
