import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PaperCard } from "@/components/paper/paper-card";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { label: true } });
  if (!tag) return { title: "Tag Not Found" };
  return { title: `${tag.label} — The Claude Journal` };
}

export default async function TagDetailPage({ params }: Props) {
  const { slug } = await params;

  const tag = await prisma.tag.findUnique({
    where: { slug },
    include: {
      papers: {
        include: {
          paper: {
            include: {
              authors: {
                include: {
                  user: { select: { displayName: true, githubLogin: true } },
                },
                orderBy: { order: "asc" as const },
              },
              tags: {
                include: { tag: { select: { slug: true, label: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!tag) notFound();

  const papers = tag.papers
    .map((pt) => pt.paper)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">{tag.label}</h1>
      <p className="mb-8 text-sm text-muted">
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
