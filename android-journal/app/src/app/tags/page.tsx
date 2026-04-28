import Link from "next/link";
import { listTags } from "@/lib/queries/tags";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const tags = await listTags();

  // Sort by paper count descending for the cloud, alphabetical for the list
  const byCount = [...tags].sort((a, b) => b._count.papers - a._count.papers);
  const maxCount = byCount[0]?._count.papers ?? 1;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-8 font-serif text-3xl font-bold">Tags</h1>

      {tags.length === 0 ? (
        <p className="text-muted">No tags yet. Tags are created when papers are submitted.</p>
      ) : (
        <>
          {/* Tag cloud */}
          <section className="mb-12">
            <div className="flex flex-wrap gap-3">
              {byCount.map((tag) => {
                const scale = 0.75 + (tag._count.papers / maxCount) * 0.75;
                return (
                  <Link
                    key={tag.slug}
                    href={`/tags/${tag.slug}`}
                    className="rounded-full border border-border px-3 py-1.5 text-muted transition-colors hover:border-link hover:text-link no-underline"
                    style={{ fontSize: `${scale}rem` }}
                  >
                    {tag.label}
                    <span className="ml-1.5 text-xs opacity-60">{tag._count.papers}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Alphabetical list */}
          <section>
            <h2 className="mb-4 font-serif text-xl font-semibold">All Tags</h2>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="tag-list">
              {tags.map((tag) => (
                <Link
                  key={tag.slug}
                  href={`/tags/${tag.slug}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-border/20 no-underline"
                  data-testid="tag-item"
                  data-slug={tag.slug}
                >
                  <span className="text-foreground" data-testid="tag-label">{tag.label}</span>
                  <span className="text-xs text-muted" data-testid="tag-count">{tag._count.papers}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
