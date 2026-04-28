import { getSession } from "@/lib/auth";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { redirect } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/paper/status-badge";
import { StatusTransition } from "@/components/dashboard/status-transition";
import { ReviewerAssignment } from "@/components/dashboard/reviewer-assignment";
import { validNextStatuses } from "@/lib/paper-workflow";
import { getUserRole, getEditorialPapers } from "@/lib/queries/dashboard";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // Fresh DB lookup — JWT role may be stale if user was demoted
  const freshUser = await getUserRole(session.userId);
  if (!freshUser || !EDITOR_ROLES.includes(freshUser.role)) {
    redirect("/");
  }

  const papers = await getEditorialPapers();

  const statusGroups = {
    submitted: papers.filter((p) => p.status === "submitted"),
    "under-review": papers.filter((p) => p.status === "under-review"),
    revision: papers.filter((p) => p.status === "revision"),
    accepted: papers.filter((p) => p.status === "accepted"),
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-8 font-serif text-3xl font-bold">Editor Dashboard</h1>

      {Object.entries(statusGroups).map(([status, group]) => (
        <section key={status} className="mb-10" data-testid={`dashboard-section-${status}`}>
          <h2 className="mb-4 flex items-center gap-3 font-serif text-xl font-semibold">
            <StatusBadge status={status} />
            <span>{group.length} paper{group.length !== 1 ? "s" : ""}</span>
          </h2>

          {group.length === 0 ? (
            <p className="text-sm text-muted">None</p>
          ) : (
            <div className="space-y-4">
              {group.map((paper) => (
                <div
                  key={paper.paperId}
                  className="rounded-lg border border-border p-5"
                  data-testid="dashboard-paper"
                  data-paper-id={paper.paperId}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <span className="mr-2 font-mono text-xs text-muted">
                        {paper.paperId}
                      </span>
                      <Link
                        href={`/papers/${paper.paperId}`}
                        className="font-serif font-semibold text-foreground hover:text-link"
                        data-testid="dashboard-paper-title"
                      >
                        {paper.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted" data-testid="dashboard-paper-author">
                        {paper.authors.map((a) => a.user.displayName).join(", ")}
                      </p>
                    </div>
                  </div>

                  {/* Reviews */}
                  <div className="mb-3">
                    <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                      Reviews ({paper.reviews.length})
                    </h3>
                    {paper.reviews.length === 0 ? (
                      <p className="text-xs text-muted">No reviewers assigned</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {paper.reviews.map((r) => (
                          <span
                            key={r.id}
                            className="rounded border border-border px-2 py-0.5 text-xs"
                            data-testid="dashboard-review"
                          >
                            {r.reviewer.displayName}:{" "}
                            <span className="font-medium">
                              {r.verdict === "pending" ? "awaiting" : r.verdict}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3">
                    <StatusTransition
                      paperId={paper.paperId}
                      currentStatus={paper.status}
                      validStatuses={validNextStatuses(paper.status)}
                    />
                    <ReviewerAssignment paperId={paper.paperId} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
