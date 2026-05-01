/**
 * /admin/monitoring/stories/[batchId]/misc — Side Effects
 *
 * Shows all business logic audit events (paper.transitioned, reviews.revealed,
 * user.created, etc.) that fired as side effects of CLI commands during a
 * story run. These are the events NOT shown in the chapters view.
 */

import { prisma } from "@/lib/db";

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  "paper.transitioned": { bg: "#dbeafe", fg: "#1e40af" },
  "paper.published": { bg: "#d1fae5", fg: "#065f46" },
  "reviews.revealed": { bg: "#ede9fe", fg: "#5b21b6" },
  "user.created": { bg: "#fce7f3", fg: "#9d174d" },
  "transition.rejected": { bg: "#fee2e2", fg: "#991b1b" },
};

const DEFAULT_COLOR = { bg: "#f3f4f6", fg: "#374151" };

function parseDetails(d: string | null): Record<string, unknown> {
  if (!d) return {};
  try { return JSON.parse(d); } catch { return {}; }
}

export default async function MiscPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;

  const events = await prisma.auditLog.findMany({
    where: {
      batchId,
      NOT: [
        { action: { startsWith: "trace.cli." } },
        { action: "story.chapter" },
      ],
    },
    orderBy: { timestamp: "asc" },
  });

  // Group by action for summary
  const actionCounts = new Map<string, number>();
  for (const e of events) {
    actionCounts.set(e.action, (actionCounts.get(e.action) ?? 0) + 1);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", margin: 0 }}>Side Effects</h2>
        <a href={`/admin/monitoring/stories/${batchId}`} style={{ fontSize: "0.8rem", color: "#6366f1", textDecoration: "none" }}>
          &larr; back to story
        </a>
      </div>
      <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "1.5rem", fontFamily: "monospace" }}>
        {batchId}
      </p>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {[...actionCounts.entries()].map(([action, count]) => {
          const color = ACTION_COLORS[action] ?? DEFAULT_COLOR;
          return (
            <div key={action} style={{
              padding: "6px 12px", borderRadius: "6px",
              backgroundColor: color.bg, color: color.fg,
              fontSize: "0.8rem", fontWeight: "bold",
            }}>
              {action} <span style={{ fontWeight: "normal", opacity: 0.7 }}>({count})</span>
            </div>
          );
        })}
      </div>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          No side effect events for this story.
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "70px 180px 140px 1fr",
            padding: "6px 12px", backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb",
            fontSize: "0.7rem", fontWeight: "bold", color: "#9ca3af",
          }}>
            <span>Time</span>
            <span>Action</span>
            <span>Entity</span>
            <span>Details</span>
          </div>

          {events.map((e) => {
            const color = ACTION_COLORS[e.action] ?? DEFAULT_COLOR;
            const det = parseDetails(e.details);
            const detailStr = Object.entries(det)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");

            return (
              <div key={e.id} style={{
                display: "grid", gridTemplateColumns: "70px 180px 140px 1fr",
                padding: "7px 12px", borderBottom: "1px solid #f3f4f6",
                fontSize: "0.82rem", alignItems: "center",
              }}>
                <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>
                  {e.timestamp.toISOString().slice(11, 19)}
                </span>
                <span>
                  <span style={{
                    padding: "1px 6px", borderRadius: "3px", fontSize: "0.7rem",
                    fontWeight: "bold", color: color.fg, backgroundColor: color.bg,
                  }}>
                    {e.action}
                  </span>
                </span>
                <span style={{ color: "#6b7280" }}>
                  {e.entity}:{e.entityId}
                </span>
                <span style={{ color: "#6b7280", fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {detailStr}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
