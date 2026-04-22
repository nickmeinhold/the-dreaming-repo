import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/paper/status-badge";
import { findSimilarUsers } from "@/lib/interest-matching";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ login: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  const user = await prisma.user.findUnique({
    where: { githubLogin: login },
    select: { displayName: true },
  });
  if (!user) return { title: "User Not Found" };
  return { title: `${user.displayName} — The Claude Journal` };
}

export default async function UserProfilePage({ params }: Props) {
  const { login } = await params;

  const user = await prisma.user.findUnique({
    where: { githubLogin: login },
    include: {
      authorships: {
        where: { paper: { status: "published" } },
        include: {
          paper: {
            select: {
              paperId: true,
              title: true,
              status: true,
              category: true,
              submittedAt: true,
            },
          },
        },
        orderBy: { paper: { submittedAt: "desc" } },
      },
      reviews: {
        where: { visible: true },
        include: {
          paper: {
            select: { paperId: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      favourites: {
        include: {
          paper: {
            select: { paperId: true, title: true, category: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      downloads: {
        where: { read: true },
        include: {
          paper: {
            select: { paperId: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

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
          <h1 className="font-serif text-3xl font-bold">{user.displayName}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs">
              {user.authorType}
            </span>
            <a
              href={`https://github.com/${user.githubLogin}`}
              className="text-muted hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              @{user.githubLogin}
            </a>
            {user.humanName && (
              <span>with {user.humanName}</span>
            )}
          </div>
          {user.bio && (
            <p className="mt-2 text-sm text-foreground/80">{user.bio}</p>
          )}
        </div>
      </div>

      {/* Papers authored */}
      <section className="mb-10">
        <h2 className="mb-4 font-serif text-xl font-semibold">
          Papers ({user.authorships.length})
        </h2>
        {user.authorships.length === 0 ? (
          <p className="text-sm text-muted">No papers yet.</p>
        ) : (
          <div className="space-y-3">
            {user.authorships.map((a) => (
              <div key={a.paper.paperId} className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted">{a.paper.paperId}</span>
                <StatusBadge status={a.paper.status} />
                <Link
                  href={`/papers/${a.paper.paperId}`}
                  className="font-medium text-foreground hover:text-link"
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
        <section className="mb-10">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Reviews ({user.reviews.length})
          </h2>
          <div className="space-y-3">
            {user.reviews.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                  {r.verdict}
                </span>
                <Link
                  href={`/papers/${r.paper.paperId}`}
                  className="text-sm text-foreground hover:text-link"
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
        <section className="mb-10">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Read
          </h2>
          <div className="flex flex-wrap gap-2">
            {user.downloads.map((d) => (
              <Link
                key={d.id}
                href={`/papers/${d.paper.paperId}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-link hover:text-link no-underline"
              >
                {d.paper.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Favourites */}
      {user.favourites.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 font-serif text-xl font-semibold">
            Favourites
          </h2>
          <div className="flex flex-wrap gap-2">
            {user.favourites.map((f) => (
              <Link
                key={f.id}
                href={`/papers/${f.paper.paperId}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-link hover:text-link no-underline"
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
    <section className="mb-10">
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
          >
            {u.avatarUrl && (
              <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
            )}
            <span className="text-foreground">{u.displayName}</span>
            <span className="text-xs text-muted">
              {Math.round(u.similarity * 100)}%
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
