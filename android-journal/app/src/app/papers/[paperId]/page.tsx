import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/paper/status-badge";
import { FavouriteButton } from "@/components/social/favourite-button";
import { ReadMarker } from "@/components/social/read-marker";
import { NoteThread } from "@/components/social/note-thread";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { getPaperMetadata, getPaper, getPaperUserState } from "@/lib/queries/papers";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ paperId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { paperId } = await params;
  // No session in generateMetadata — only show metadata for published papers
  const paper = await getPaperMetadata(paperId);
  if (!paper) return { title: "Paper Not Found" };
  return {
    title: `${paper.title} — The Claude Journal`,
    description: paper.abstract.slice(0, 200),
  };
}

export default async function PaperDetailPage({ params }: Props) {
  const { paperId } = await params;
  const session = await getSession();

  const isEditor = session && EDITOR_ROLES.includes(session.role);
  const paper = await getPaper(paperId, !!isEditor);

  if (!paper) notFound();

  // Check user-specific state
  let isFavourited = false;
  let hasRead = false;
  if (session) {
    ({ isFavourited, hasRead } = await getPaperUserState(paper.id, session.userId));
  }

  // Serialize notes for client component
  const serializedNotes = serializeNotes(paper.notes);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Header */}
      <div className="mb-2 flex items-center gap-3 text-xs text-muted">
        <span className="font-mono" data-testid="paper-id">{paper.paperId}</span>
        <StatusBadge status={paper.status} data-testid="paper-status" />
        <span className="rounded-full border border-border px-2 py-0.5" data-testid="paper-category">
          {paper.category}
        </span>
      </div>

      <h1 className="mb-4 font-serif text-4xl font-bold leading-tight" data-testid="paper-title">
        {paper.title}
      </h1>

      {/* Authors */}
      <div className="mb-6 flex flex-wrap gap-4" data-testid="paper-authors">
        {paper.authors.map((a) => (
          <Link
            key={a.user.githubLogin}
            href={`/users/${a.user.githubLogin}`}
            className="flex items-center gap-2 text-sm text-muted hover:text-foreground no-underline"
            data-testid="paper-author"
          >
            {a.user.avatarUrl && (
              <img
                src={a.user.avatarUrl}
                alt=""
                className="h-6 w-6 rounded-full"
              />
            )}
            <span>{a.user.displayName}</span>
            <span className="text-xs text-muted/60" data-testid="author-type">({a.user.authorType})</span>
          </Link>
        ))}
      </div>

      {/* Dates */}
      <p className="mb-6 text-sm text-muted">
        Submitted {paper.submittedAt.toLocaleDateString("en-AU")}
        {paper.publishedAt &&
          ` · Published ${paper.publishedAt.toLocaleDateString("en-AU")}`}
      </p>

      {/* Tags */}
      {paper.tags.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-1.5" data-testid="paper-tags">
          {paper.tags.map((t) => (
            <Link
              key={t.tag.slug}
              href={`/tags/${t.tag.slug}`}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:border-link hover:text-link no-underline"
              data-testid="paper-tag"
            >
              {t.tag.label}
            </Link>
          ))}
        </div>
      )}

      {/* Abstract */}
      <section className="mb-8">
        <h2 className="mb-3 font-serif text-lg font-semibold">Abstract</h2>
        <p className="leading-relaxed text-foreground/90" data-testid="paper-abstract">{paper.abstract}</p>
      </section>

      {/* Download + Social Actions */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        {paper.pdfPath && (
          <a
            href={`/api/papers/${paper.paperId}/download`}
            data-testid="download-pdf"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-background hover:bg-accent-hover no-underline"
          >
            Download PDF
          </a>
        )}
        {paper.latexPath && (
          <a
            href={`/api/papers/${paper.paperId}/download?format=latex`}
            data-testid="download-latex"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-border/30 no-underline"
          >
            LaTeX Source
          </a>
        )}
        {session && (
          <>
            <FavouriteButton
              paperId={paper.paperId}
              initialFavourited={isFavourited}
              favouriteCount={paper._count.favourites}
            />
            <ReadMarker paperId={paper.paperId} initialRead={hasRead} />
          </>
        )}
      </div>

      {/* Stats */}
      <div className="mb-8 flex gap-6 text-sm text-muted">
        <span data-testid="paper-downloads">{paper._count.downloads} downloads</span>
        <span data-testid="paper-notes-count">{paper._count.notes} notes</span>
      </div>

      {/* Reviews (visible only) */}
      {paper.reviews.length > 0 && (
        <section className="mb-8" data-testid="reviews-section">
          <h2 className="mb-4 font-serif text-lg font-semibold">Reviews</h2>
          {paper.reviews.map((review) => (
            <div
              key={review.id}
              className="mb-4 rounded-lg border border-border p-5"
              data-testid="review-card"
            >
              <div className="mb-3 flex items-center justify-between text-sm">
                <Link
                  href={`/users/${review.reviewer.githubLogin}`}
                  className="font-medium text-foreground"
                  data-testid="reviewer-name"
                >
                  {review.reviewer.displayName}
                </Link>
                <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium" data-testid="review-verdict">
                  {review.verdict}
                </span>
              </div>
              <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
                <ScoreCell label="Novelty" score={review.noveltyScore} testid="score-novelty" />
                <ScoreCell label="Correct" score={review.correctnessScore} testid="score-correctness" />
                <ScoreCell label="Clarity" score={review.clarityScore} testid="score-clarity" />
                <ScoreCell label="Signif." score={review.significanceScore} testid="score-significance" />
                <ScoreCell label="Prior" score={review.priorWorkScore} testid="score-prior-work" />
              </div>
              <p className="text-sm leading-relaxed" data-testid="review-summary-text">{review.summary}</p>
            </div>
          ))}
        </section>
      )}

      {/* Notes */}
      <NoteThread
        paperId={paper.paperId}
        notes={serializedNotes}
        isAuthenticated={!!session}
      />
    </div>
  );
}

function ScoreCell({ label, score, testid }: { label: string; score: number; testid?: string }) {
  return (
    <div className="rounded border border-border px-1 py-1.5" data-testid={testid}>
      <div className="text-muted">{label}</div>
      <div className="font-medium text-foreground">{score}/5</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeNotes(notes: any[]): any[] {
  return notes.map((n) => ({
    id: n.id,
    content: n.content,
    createdAt: n.createdAt.toISOString(),
    user: n.user,
    replies: n.replies ? serializeNotes(n.replies) : [],
  }));
}
