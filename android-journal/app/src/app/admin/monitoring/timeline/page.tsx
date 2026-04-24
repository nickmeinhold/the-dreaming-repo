/**
 * /admin/monitoring/timeline — Chronological Event Feed
 *
 * CLI equivalent: journal analyze timeline
 * Shows all audit events in chronological order with filtering.
 */

import { prisma } from "@/lib/db";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filterAction = params.action || null;
  const filterEntity = params.entity || null;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const perPage = 50;

  const where: Record<string, unknown> = {};
  if (filterAction) where.action = filterAction;
  if (filterEntity) where.entity = filterEntity;

  const [events, totalCount, entityCounts] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: perPage,
      skip: (currentPage - 1) * perPage,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ["entity"],
      _count: true,
      orderBy: { _count: { entity: "desc" } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  const ACTION_COLORS: Record<string, string> = {
    "paper.submitted": "#3b82f6", "paper.transitioned": "#8b5cf6", "paper.downloaded": "#06b6d4",
    "review.assigned": "#f59e0b", "review.submitted": "#10b981", "note.added": "#6366f1",
    "auth.login": "#059669", "auth.failed": "#dc2626", "access.denied": "#dc2626", "system.error": "#dc2626",
  };

  function url(overrides: Record<string, string | null>) {
    const p: string[] = [];
    const merged = { action: filterAction, entity: filterEntity, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.push(`${k}=${v}`);
    }
    return `/admin/monitoring/timeline${p.length ? `?${p.join("&")}` : ""}`;
  }

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Timeline</h2>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        {totalCount} events
        {filterAction && <> — <strong>{filterAction}</strong></>}
        {filterEntity && <> — <strong>{filterEntity}</strong></>}
        {(filterAction || filterEntity) && <a href="/admin/monitoring/timeline" style={{ marginLeft: "0.5rem" }}>[clear]</a>}
      </p>

      {/* Entity filters */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "1rem", flexWrap: "wrap" }}>
        {entityCounts.map(({ entity, _count }) => (
          <a key={entity} href={url({ entity })}
            style={{
              padding: "3px 8px", borderRadius: "10px", fontSize: "0.75rem", textDecoration: "none",
              color: filterEntity === entity ? "#fff" : "#374151",
              backgroundColor: filterEntity === entity ? "#6b7280" : "#f3f4f6",
              border: "1px solid #d1d5db",
            }}>
            {entity} ({_count})
          </a>
        ))}
      </div>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No events</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {events.map((e) => {
            const det = tryParseDetails(e.details);
            const bg = ACTION_COLORS[e.action] || (e.action.startsWith("trace.") ? "#e5e7eb" : "#6b7280");
            const rowStyle = { padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem", display: "flex", gap: "8px", alignItems: "center" };
            const inner = (
              <>
                <span style={{ color: "#9ca3af", minWidth: "55px" }}>{e.timestamp.toISOString().slice(11, 19)}</span>
                <span style={{ padding: "1px 6px", borderRadius: "3px", fontSize: "0.7rem", fontWeight: "bold", color: e.action.startsWith("trace.") ? "#374151" : "#fff", backgroundColor: bg, minWidth: "90px", textAlign: "center" }}>
                  {e.action}
                </span>
                <span style={{ color: "#6b7280" }}>{e.entity}:{e.entityId}</span>
                {det.steps && (
                  <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                    {det.steps.split(" → ").map((s, i) => {
                      const [name, status] = s.split(":");
                      return <span key={i}>{i > 0 && " → "}<span style={{ color: status === "err" ? "#dc2626" : "#9ca3af" }}>{name}</span></span>;
                    })}
                  </span>
                )}
                {det.ms !== undefined && <span style={{ fontSize: "0.7rem", color: det.ms > 100 ? "#f59e0b" : "#9ca3af" }}>{det.ms}ms</span>}
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
          {currentPage > 1 && <a href={url({ page: String(currentPage - 1) })} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Prev</a>}
          <span style={{ padding: "4px 12px", color: "#6b7280" }}>{currentPage}/{totalPages}</span>
          {currentPage < totalPages && <a href={url({ page: String(currentPage + 1) })} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Next</a>}
        </div>
      )}
    </>
  );
}

function tryParseDetails(d: string | null): { steps?: string; ms?: number; status?: string; error?: string } {
  if (!d) return {};
  try { const p = JSON.parse(d); return (p.steps && typeof p.steps === "string") ? p : {}; } catch { return {}; }
}
