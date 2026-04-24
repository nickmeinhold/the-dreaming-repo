/**
 * /admin/monitoring/auth — Authentication Events
 *
 * CLI equivalent: journal analyze auth
 * Shows logins, login failures, and access denied events.
 */

import { prisma } from "@/lib/db";

const AUTH_ACTIONS = ["auth.login", "auth.failed", "access.denied", "trace.auth.github-callback"];

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; failures?: string }>;
}) {
  const params = await searchParams;
  const failuresOnly = params.failures === "true";
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const perPage = 50;

  const failureActions = ["auth.failed", "access.denied"];
  const where = failuresOnly
    ? { action: { in: failureActions } }
    : { action: { in: AUTH_ACTIONS } };

  const [events, totalCount, loginCount, failCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: perPage,
      skip: (currentPage - 1) * perPage,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { action: "auth.login" } }),
    prisma.auditLog.count({ where: { action: { in: failureActions } } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Authentication</h2>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ padding: "0.75rem 1rem", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#059669" }}>{loginCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Logins</div>
        </div>
        <div style={{ padding: "0.75rem 1rem", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: failCount > 0 ? "#dc2626" : "#059669" }}>{failCount}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Failures</div>
        </div>
        <div style={{ alignSelf: "center" }}>
          <a href={failuresOnly ? "/admin/monitoring/auth" : "/admin/monitoring/auth?failures=true"}
            style={{ fontSize: "0.8rem", color: "#6366f1", textDecoration: "none" }}>
            {failuresOnly ? "Show all" : "Show failures only"}
          </a>
        </div>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>No auth events</div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {events.map((e) => {
            const isFailure = ["auth.failed", "access.denied"].includes(e.action);
            const det = tryParse(e.details);
            return (
              <div key={e.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem", display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ color: "#9ca3af", minWidth: "145px", fontSize: "0.8rem" }}>
                  {e.timestamp.toISOString().replace("T", " ").slice(0, 19)}
                </span>
                <span style={{ fontSize: "1.1rem" }}>{isFailure ? "🔴" : "🟢"}</span>
                <span style={{ fontWeight: "bold", color: isFailure ? "#dc2626" : "#059669" }}>{e.action}</span>
                {det?.githubLogin && <span style={{ color: "#6b7280" }}>{det.githubLogin}</span>}
                {det?.had && <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>had:{det.had} needed:{det.needed}</span>}
                {e.correlationId && (
                  <a href={`/admin/monitoring/trace/${e.correlationId}`} style={{ marginLeft: "auto", color: "#6366f1", fontSize: "0.7rem", textDecoration: "none" }}>trace</a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1.5rem" }}>
          {currentPage > 1 && <a href={`/admin/monitoring/auth?${failuresOnly ? "failures=true&" : ""}page=${currentPage - 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Prev</a>}
          <span style={{ padding: "4px 12px", color: "#6b7280" }}>{currentPage}/{totalPages}</span>
          {currentPage < totalPages && <a href={`/admin/monitoring/auth?${failuresOnly ? "failures=true&" : ""}page=${currentPage + 1}`} style={{ padding: "4px 12px", border: "1px solid #d1d5db", borderRadius: "4px", textDecoration: "none", color: "#374151" }}>Next</a>}
        </div>
      )}
    </>
  );
}

function tryParse(d: string | null): Record<string, string> | null {
  if (!d) return null;
  try { return JSON.parse(d); } catch { return null; }
}
