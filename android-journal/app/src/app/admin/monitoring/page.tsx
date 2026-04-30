/**
 * /admin/monitoring — Summary Dashboard
 *
 * CLI equivalent: journal analyze summary
 * Overview: total events, errors, active users, breakdown by action, recent activity.
 */

import { prisma } from "@/lib/db";

const ERROR_ACTIONS = ["access.denied", "system.error", "auth.failed"];

export default async function SummaryPage() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since1h = new Date(Date.now() - 60 * 60 * 1000);

  const [total24h, errors24h, errors1h, activeUsers, actionCounts, recent] = await Promise.all([
    prisma.auditLog.count({ where: { timestamp: { gte: since24h } } }),
    prisma.auditLog.count({ where: { timestamp: { gte: since24h }, action: { in: ERROR_ACTIONS } } }),
    prisma.auditLog.count({ where: { timestamp: { gte: since1h }, action: { in: ERROR_ACTIONS } } }),
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { timestamp: { gte: since24h }, userId: { not: null } },
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { timestamp: { gte: since24h } },
      _count: true,
      orderBy: { _count: { action: "desc" } },
    }),
    prisma.auditLog.findMany({
      where: { timestamp: { gte: since1h } },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
  ]);

  return (
    <>
      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Events (24h)" value={total24h} testid="monitor-events" />
        <StatCard label="Errors (24h)" value={errors24h} color={errors24h > 0 ? "#dc2626" : "#059669"} testid="monitor-errors" />
        <StatCard label="Errors (1h)" value={errors1h} color={errors1h > 0 ? "#dc2626" : "#059669"} />
        <StatCard label="Active Users" value={activeUsers.length} testid="monitor-active-users" />
      </div>

      {/* Action breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Action Breakdown (24h)</h2>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }} data-testid="monitor-breakdown">
            {actionCounts.map(({ action, _count }) => (
              <div key={action} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }} data-testid="breakdown-item">
                <a href={`/admin/monitoring/timeline?action=${action}`} style={{ textDecoration: "none", color: "#374151" }} data-testid="breakdown-action">
                  {action}
                </a>
                <span style={{ color: "#6b7280", fontWeight: "bold" }} data-testid="breakdown-count">{_count}</span>
              </div>
            ))}
            {actionCounts.length === 0 && (
              <div style={{ padding: "1rem", color: "#9ca3af", textAlign: "center" }}>No events in the last 24h</div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recent (1h)</h2>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }} data-testid="monitor-recent">
            {recent.map((e) => (
              <div key={e.id} style={{ padding: "6px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem", display: "flex", gap: "8px" }} data-testid="recent-event">
                <span style={{ color: "#9ca3af", minWidth: "55px" }} data-testid="event-timestamp">
                  {e.timestamp.toISOString().slice(11, 19)}
                </span>
                <ActionBadge action={e.action} testid="event-action" />
                <span style={{ color: "#6b7280" }} data-testid="event-entity">{e.entityId}</span>
                {e.correlationId && (
                  <a href={`/admin/monitoring/trace/${e.correlationId}`} style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.7rem", textDecoration: "none" }}>
                    trace
                  </a>
                )}
              </div>
            ))}
            {recent.length === 0 && (
              <div style={{ padding: "1rem", color: "#9ca3af", textAlign: "center" }}>Quiet hour</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, color, testid }: { label: string; value: number; color?: string; testid?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "1rem", textAlign: "center" }} data-testid={testid}>
      <div style={{ fontSize: "2rem", fontWeight: "bold", color: color ?? "#111827" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function ActionBadge({ action, testid }: { action: string; testid?: string }) {
  const COLORS: Record<string, string> = {
    "paper.submitted": "#3b82f6", "paper.transitioned": "#8b5cf6", "paper.downloaded": "#06b6d4",
    "review.assigned": "#f59e0b", "review.submitted": "#10b981", "note.added": "#6366f1",
    "auth.login": "#059669", "auth.failed": "#dc2626", "access.denied": "#dc2626", "system.error": "#dc2626",
  };
  const bg = action.startsWith("trace.") ? "#e5e7eb" : (COLORS[action] || "#6b7280");
  const fg = action.startsWith("trace.") ? "#374151" : "#fff";
  return (
    <span style={{ padding: "1px 6px", borderRadius: "3px", fontSize: "0.7rem", fontWeight: "bold", color: fg, backgroundColor: bg }} data-testid={testid}>
      {action}
    </span>
  );
}
