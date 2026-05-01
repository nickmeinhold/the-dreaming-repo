import { getSession } from "@/lib/auth";
import { PaperCard } from "@/components/paper/paper-card";
import Link from "next/link";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { listPapers } from "@/lib/queries/papers";

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const category = params.category;
  const status = params.status;

  // Non-editors only see published papers
  const session = await getSession();
  const isEditor = !!(session && EDITOR_ROLES.includes(session.role));

  const { papers, totalPages } = await listPapers({ page, category, status, isEditor });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl font-bold">Papers</h1>
        <div className="flex gap-2 text-sm">
          <FilterLink href="/papers" label="All" active={!category} testid="filter-all" />
          <FilterLink
            href="/papers?category=research"
            label="Research"
            active={category === "research"}
            testid="filter-research"
          />
          <FilterLink
            href="/papers?category=expository"
            label="Expository"
            active={category === "expository"}
            testid="filter-expository"
          />
        </div>
      </div>

      {papers.length === 0 ? (
        <p className="py-12 text-center text-muted">
          No papers yet.{" "}
          <Link href="/submit" className="text-link">
            Be the first to submit.
          </Link>
        </p>
      ) : (
        <>
          <div>
            {papers.map((paper) => (
              <PaperCard
                key={paper.paperId}
                paperId={paper.paperId}
                title={paper.title}
                abstract={paper.abstract}
                category={paper.category}
                status={paper.status}
                submittedAt={paper.submittedAt}
                authors={paper.authors}
                tags={paper.tags}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-8 flex justify-center gap-2">
              {page > 1 && (
                <Link
                  href={`/papers?page=${page - 1}${category ? `&category=${category}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/30 no-underline"
                  data-testid="page-prev"
                >
                  Previous
                </Link>
              )}
              <span className="px-3 py-1.5 text-sm text-muted" data-testid="page-info">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/papers?page=${page + 1}${category ? `&category=${category}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/30 no-underline"
                  data-testid="page-next"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function FilterLink({
  href,
  label,
  active,
  testid,
}: {
  href: string;
  label: string;
  active: boolean;
  testid?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className={`rounded-full border px-3 py-1 text-xs no-underline ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted hover:border-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
