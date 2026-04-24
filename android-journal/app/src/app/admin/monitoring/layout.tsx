import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { redirect } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/monitoring", label: "Summary" },
  { href: "/admin/monitoring/errors", label: "Errors" },
  { href: "/admin/monitoring/timeline", label: "Timeline" },
  { href: "/admin/monitoring/auth", label: "Auth" },
  { href: "/admin/monitoring/slow", label: "Slow" },
  { href: "/admin/monitoring/api", label: "API" },
  { href: "/admin/monitoring/cli", label: "CLI" },
  { href: "/admin/monitoring/db", label: "DB" },
  { href: "/admin/monitoring/metrics", label: "Metrics" },
];

export default async function MonitoringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const freshUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });
  if (!freshUser || !EDITOR_ROLES.includes(freshUser.role)) redirect("/");

  return (
    <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem", fontFamily: "monospace" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1.5rem", marginBottom: "1.5rem", borderBottom: "1px solid #e5e7eb", paddingBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.3rem" }}>Monitoring</h1>
        <nav style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {NAV_ITEMS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              style={{
                padding: "4px 12px",
                borderRadius: "6px",
                fontSize: "0.8rem",
                textDecoration: "none",
                color: "#374151",
                backgroundColor: "#f3f4f6",
                border: "1px solid #e5e7eb",
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      {children}
    </main>
  );
}
