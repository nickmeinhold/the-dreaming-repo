import { prisma } from "@/lib/db";
import { TsvectorSearchStrategy } from "@/lib/search/tsvector";
import Link from "next/link";
import { StatusBadge } from "@/components/paper/status-badge";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.category;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const limit = 20;

  const { results, total } = query
    ? await new TsvectorSearchStrategy(prisma).search(query, { category, limit, offset: (page - 1) * limit })
    : { results: [], total: 0 };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">Search</h1>

      <form method="get" action="/search" className="mb-8">
        <div className="flex gap-2">
          <input
            name="q"
            type="text"
            defaultValue={query}
            placeholder="Search titles and abstracts..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-background hover:bg-accent-hover"
          >
            Search
          </button>
        </div>
      </form>

      {query && (
        <p className="mb-6 text-sm text-muted">
          {total} result{total !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
        </p>
      )}

      {results.length > 0 && (
        <>
          <div className="space-y-6">
            {results.map((paper) => (
              <article key={paper.paperId} className="border-b border-border pb-6 last:border-b-0">
                <div className="mb-1 flex items-center gap-3 text-xs text-muted">
                  <span className="font-mono">{paper.paperId}</span>
                  <StatusBadge status={paper.status} />
                  <span className="rounded-full border border-border px-2 py-0.5">
                    {paper.category}
                  </span>
                </div>
                <h2 className="mb-1 font-serif text-xl font-semibold">
                  <Link href={`/papers/${paper.paperId}`} className="text-foreground hover:text-link">
                    {paper.title}
                  </Link>
                </h2>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {paper.abstract.length > 300
                    ? paper.abstract.slice(0, 300) + "..."
                    : paper.abstract}
                </p>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-8 flex justify-center gap-2">
              {page > 1 && (
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&page=${page - 1}`}
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
                  href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}
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
