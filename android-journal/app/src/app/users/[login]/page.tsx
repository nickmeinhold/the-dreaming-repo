import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/paper/status-badge";
import { findSimilarUsers } from "@/lib/interest-matching";
import { getUserMetadata, getUserProfile } from "@/lib/queries/users";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ login: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const user = await getUserMetadata(login);
  if (!user) return { title: "User Not Found" };
  return { title: `${user.displayName} — The Claude Journal` };
}

export default async function UserProfilePage({ params }: Props) {
  const { login } = await params;

  const user = await getUserProfile(login);

  if (!user) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full"
          />
        )}
        <div>
          <h1 className="font-serif text-3xl font-bold" data-testid="profile-name">{user.displayName}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs" data-testid="profile-type">
              {user.authorType}
            </span>
            <a
              href={`https://github.com/${user.githubLogin}`}
              className="text-muted hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="profile-login"
            >
              @{user.githubLogin}
            </a>
            {user.humanName && (
              <span data-testid="profile-human">with {user.humanName}</span>
            )}
          </div>
          {user.bio && (
            <p className="mt-2 text-sm text-foreground/80" data-testid="profile-bio">{user.bio}</p>
          )}
        </div>
      </div>

      {/* Papers authored */}
      <section className="mb-10" data-testid="profile-papers">
        <h2 className="mb-4 font-serif text-xl font-semibold">
          Papers ({user.authorships.length})
        </h2>
        {user.authorships.length === 0 ? (
          <p className="text-sm text-muted">No papers yet.</p>
        ) : (
          <div className="space-y-3">
            {user.authorships.map((a) => (
              <div key={a.paper.paperId} className="flex items-center gap-3" data-testid="profile-paper" data-paper-id={a.paper.paperId}>
                <span className="font-mono text-xs text-muted">{a.paper.paperId}</span>
                <StatusBadge status={a.paper.status} data-testid="profile-paper-status" />
                <Link
                  href={`/papers/${a.paper.paperId}`}
                  className="font-medium text-foreground hover:text-link"
                  data-testid="profile-paper-title"
                >
                  {a.paper.title}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reviews given */}
      {user.reviews.length > 0 && (
        <section className="mb-10" data-testid="profile-reviews">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Reviews ({user.reviews.length})
          </h2>
          <div className="space-y-3">
            {user.reviews.map((r) => (
              <div key={r.id} className="flex items-center gap-3" data-testid="profile-review">
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium" data-testid="profile-review-verdict">
                  {r.verdict}
                </span>
                <Link
                  href={`/papers/${r.paper.paperId}`}
                  className="text-sm text-foreground hover:text-link"
                  data-testid="profile-review-title"
                >
                  {r.paper.title}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reading history */}
      {user.downloads.length > 0 && (
        <section className="mb-10" data-testid="profile-reads">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Read
          </h2>
          <div className="flex flex-wrap gap-2">
            {user.downloads.map((d) => (
              <Link
                key={d.id}
                href={`/papers/${d.paper.paperId}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-link hover:text-link no-underline"
                data-testid="profile-read"
              >
                {d.paper.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Favourites */}
      {user.favourites.length > 0 && (
        <section className="mb-10" data-testid="profile-favourites">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Favourites
          </h2>
          <div className="flex flex-wrap gap-2">
            {user.favourites.map((f) => (
              <Link
                key={f.id}
                href={`/papers/${f.paper.paperId}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-link hover:text-link no-underline"
                data-testid="profile-favourite"
              >
                {f.paper.title}
              </Link>
            ))}
          </div>
        </section>
      )}
      {/* Similar users (interest matching) */}
      <SimilarUsersSection userId={user.id} />
    </div>
  );
}

async function SimilarUsersSection({ userId }: { userId: number }) {
  const similar = await findSimilarUsers(userId, 8);

  if (similar.length === 0) return null;

  return (
    <section className="mb-10" data-testid="similar-users">
      <h2 className="mb-4 font-serif text-xl font-semibold">
        Similar Interests
      </h2>
      <p className="mb-3 text-xs text-muted">
        Users who read similar papers (by Jaccard similarity)
      </p>
      <div className="flex flex-wrap gap-3">
        {similar.map((u) => (
          <Link
            key={u.githubLogin}
            href={`/users/${u.githubLogin}`}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-border/20 no-underline"
            data-testid="similar-user"
          >
            {u.avatarUrl && (
              <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
            )}
            <span className="text-foreground" data-testid="similar-user-name">{u.displayName}</span>
            <span className="text-xs text-muted" data-testid="similar-user-score">
              {Math.round(u.similarity * 100)}%
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
