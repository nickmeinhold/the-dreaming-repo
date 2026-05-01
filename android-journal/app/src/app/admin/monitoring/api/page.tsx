/**
 * /admin/monitoring/api — API Activity
 *
 * CLI equivalent: journal analyze requests --api
 * Shows trace events for API-facing actions (downloads, submissions, reviews).
 */

import { prisma } from "@/lib/db";

const API_ACTIONS = [
  "trace.paper.submit", "trace.paper.download", "trace.paper.transition",
  "trace.reviewer.assign", "trace.review.submit",
  "trace.note.add", "trace.favourite.toggle", "trace.read.mark",
  "trace.auth.github-callback",
  "paper.submitted", "paper.transitioned", "paper.downloaded",
  "review.assigned", "review.submitted", "note.added",
];

export default async function ApiPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const perPage = 50;

  const where = { action: { in: API_ACTIONS } };

  const [events, totalCount, actionCounts] = await Promise.all([
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
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>API Activity</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>{totalCount} API events</p>

      {/* Breakdown chips */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "1rem", flexWrap: "wrap" }}>
        {actionCounts.map(({ action, _count }) => (
          <span key={action} style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "0.7rem", backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb", color: "#374151" }}>
            {action.replace("trace.", "")} ({_count})
          </span>
        ))}
      </div>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No API events yet</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {events.map((e) => {
            const rowStyle = { padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem", display: "flex", gap: "8px", alignItems: "center" };
            const inner = (
              <>
                <span style={{ color: "#9ca3af", minWidth: "55px" }}>{e.timestamp.toISOString().slice(11, 19)}</span>
                <span style={{
                  padding: "1px 6px", borderRadius: "3px", fontSize: "0.7rem", fontWeight: "bold",
                  backgroundColor: e.action.startsWith("trace.") ? "#e5e7eb" : "#3b82f6",
                  color: e.action.startsWith("trace.") ? "#374151" : "#fff",
                  minWidth: "80px", textAlign: "center",
                }}>
                  {e.action.replace("trace.", "")}
                </span>
                <span style={{ color: "#6b7280" }}>{e.entityId}</span>
                {e.status && (
                  <span style={{ fontSize: "0.7rem", padding: "1px 4px", borderRadius: "3px", backgroundColor: e.status === "ok" ? "#d1fae5" : "#fee2e2", color: e.status === "ok" ? "#065f46" : "#991b1b" }}>
                    {e.status}
                  </span>
                )}
                {e.durationMs != null && e.durationMs > 0 && <span style={{ fontSize: "0.7rem", color: e.durationMs > 100 ? "#f59e0b" : "#9ca3af" }}>{e.durationMs}ms</span>}
                {e.userId && <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>user:{e.userId}</span>}
              </>
            );
            return e.correlationId ? (
              <a key={e.id} href={`/admin/monitoring/trace/${e.correlationId}`} style={{ ...rowStyle, display: "flex", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
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
          {currentPage > 1 && <a href={`/admin/monitoring/api?page=${currentPage - 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Prev</a>}
          <span style={{ padding: "4px 12px", color: "#6b7280" }}>{currentPage}/{totalPages}</span>
          {currentPage < totalPages && <a href={`/admin/monitoring/api?page=${currentPage + 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Next</a>}
        </div>
      )}
    </>
  );
}

