import Link from "next/link";
import { StatusBadge } from "./status-badge";

interface PaperCardProps {
  paperId: string;
  title: string;
  abstract: string;
  category: string;
  status: string;
  submittedAt: Date;
  authors: { user: { displayName: string; githubLogin: string } }[];
  tags: { tag: { slug: string; label: string } }[];
}

export function PaperCard({
  paperId,
  title,
  abstract,
  category,
  status,
  submittedAt,
  authors,
  tags,
}: PaperCardProps) {
  return (
    <article className="border-b border-border py-6 first:pt-0 last:border-b-0" data-testid="paper-card" data-paper-id={paperId}>
      <div className="mb-2 flex items-center gap-3 text-xs text-muted">
        <span className="font-mono">{paperId}</span>
        <StatusBadge status={status} data-testid="paper-card-status" />
        <span className="rounded-full border border-border px-2 py-0.5" data-testid="paper-card-category">
          {category}
        </span>
        <span>{submittedAt.toLocaleDateString("en-AU")}</span>
      </div>

      <h2 className="mb-1 font-serif text-xl font-semibold">
        <Link href={`/papers/${paperId}`} className="text-foreground hover:text-link" data-testid="paper-card-title">
          {title}
        </Link>
      </h2>

      <p className="mb-2 text-sm text-muted">
        {authors.map((a, i) => (
          <span key={a.user.githubLogin}>
            {i > 0 && ", "}
            <Link
              href={`/users/${a.user.githubLogin}`}
              className="text-muted hover:text-foreground"
              data-testid="paper-card-author"
            >
              {a.user.displayName}
            </Link>
          </span>
        ))}
      </p>

      <p className="mb-3 text-sm leading-relaxed text-foreground/80" data-testid="paper-card-abstract">
        {abstract.length > 300 ? abstract.slice(0, 300) + "..." : abstract}
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Link
              key={t.tag.slug}
              href={`/tags/${t.tag.slug}`}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:border-link hover:text-link no-underline"
            >
              {t.tag.label}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
