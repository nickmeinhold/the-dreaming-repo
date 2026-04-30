/**
 * /admin/monitoring/errors — Error Log
 *
 * CLI equivalent: journal analyze errors
 * Shows access.denied, system.error, auth.failed, and trace failures.
 * Every row is clickable — links to the full trace detail.
 */

import { prisma } from "@/lib/db";

import { ERROR_ACTIONS } from "@/lib/constants";

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const perPage = 50;

  const where = {
    OR: [
      { action: { in: ERROR_ACTIONS } },
      { action: { startsWith: "trace." }, status: "err" },
    ],
  };

  const [events, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: perPage,
      skip: (currentPage - 1) * perPage,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Errors & Warnings</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1rem" }}>
        {totalCount} error event{totalCount !== 1 ? "s" : ""}
      </p>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#059669", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No errors. Everything is fine.</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {events.map((e) => {
            const det = parseDetails(e.details);
            const content = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ color: "#9ca3af", fontSize: "0.8rem", minWidth: "145px" }}>
                    {e.timestamp.toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                  <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold", color: "#fff", backgroundColor: "#dc2626" }}>
                    {e.action}
                  </span>
                  <span style={{ fontSize: "0.85rem" }}>
                    <span style={{ color: "#6b7280" }}>{e.entity}:</span><strong>{e.entityId}</strong>
                  </span>
                  {e.correlationId && (
                    <span style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.8rem" }}>→</span>
                  )}
                </div>
                {det.steps && (
                  <div style={{ marginTop: "4px", paddingLeft: "155px", fontSize: "0.75rem" }}>
                    {det.steps.split(" → ").map((step: string, i: number) => {
                      const [name, status] = step.split(":");
                      return (
                        <span key={i}>
                          {i > 0 && <span style={{ color: "#d1d5db" }}> → </span>}
                          <span style={{ color: status === "ok" ? "#059669" : "#dc2626", fontWeight: status === "err" ? "bold" : "normal" }}>{name}</span>
                        </span>
                      );
                    })}
                    {det.error && <span style={{ color: "#dc2626", marginLeft: "8px" }}>({det.error})</span>}
                  </div>
                )}
                {!det.steps && e.details && (
                  <div style={{ marginTop: "4px", paddingLeft: "155px", fontSize: "0.8rem", color: "#6b7280" }}>
                    {e.details}
                  </div>
                )}
              </>
            );

            if (e.correlationId) {
              return (
                <a key={e.id} href={`/admin/monitoring/trace/${e.correlationId}`}
                  style={{ display: "block", padding: "10px 14px", backgroundColor: "#fff", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
                  {content}
                </a>
              );
            }
            return (
              <div key={e.id} style={{ padding: "10px 14px", backgroundColor: "#fff", borderBottom: "1px solid #f3f4f6" }}>
                {content}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1.5rem" }}>
          {currentPage > 1 && <a href={`/admin/monitoring/errors?page=${currentPage - 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Prev</a>}
          <span style={{ padding: "4px 12px", color: "#6b7280" }}>Page {currentPage} of {totalPages}</span>
          {currentPage < totalPages && <a href={`/admin/monitoring/errors?page=${currentPage + 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Next</a>}
        </div>
      )}
    </>
  );
}

function parseDetails(details: string | null): { steps?: string; status?: string; ms?: number; error?: string } {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    if (parsed.steps && typeof parsed.steps === "string" && parsed.steps.includes("→")) return parsed;
    return {};
  } catch { return {}; }
}
