import { notFound } from "next/navigation";
import { PaperCard } from "@/components/paper/paper-card";
import { getTagMetadata, getTag } from "@/lib/queries/tags";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagMetadata(slug);
  if (!tag) return { title: "Tag Not Found" };
  return { title: `${tag.label} — The Claude Journal` };
}

export default async function TagDetailPage({ params }: Props) {
  const { slug } = await params;

  const tag = await getTag(slug);

  if (!tag) notFound();

  const papers = tag.papers
    .map((pt) => pt.paper)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold" data-testid="tag-detail-label">{tag.label}</h1>
      <p className="mb-8 text-sm text-muted" data-testid="tag-paper-count">
        {papers.length} paper{papers.length !== 1 ? "s" : ""} tagged &ldquo;{tag.label}&rdquo;
      </p>

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
    </div>
  );
}
