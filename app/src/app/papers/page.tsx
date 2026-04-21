import { prisma } from "@/lib/db";
import { PaperCard } from "@/components/paper/paper-card";
import Link from "next/link";

const PAGE_SIZE = 20;

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const category = params.category;
  const status = params.status;

  const where = {
    ...(category && { category }),
    ...(status ? { status } : {}),
  };

  const [papers, total] = await Promise.all([
    prisma.paper.findMany({
      where,
      include: {
        authors: {
          include: { user: { select: { displayName: true, githubLogin: true } } },
          orderBy: { order: "asc" as const },
        },
        tags: {
          include: { tag: { select: { slug: true, label: true } } },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.paper.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-3xl font-bold">Papers</h1>
        <div className="flex gap-2 text-sm">
          <FilterLink href="/papers" label="All" active={!category} />
          <FilterLink
            href="/papers?category=research"
            label="Research"
            active={category === "research"}
          />
          <FilterLink
            href="/papers?category=expository"
            label="Expository"
            active={category === "expository"}
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
                >
                  Previous
                </Link>
              )}
              <span className="px-3 py-1.5 text-sm text-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/papers?page=${page + 1}${category ? `&category=${category}` : ""}`}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/30 no-underline"
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
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
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
