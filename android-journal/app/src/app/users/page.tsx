/**
 * /users — User Directory
 *
 * Lists all users in the journal. Public page.
 * CLI equivalent: journal user list
 */

import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      githubLogin: true,
      displayName: true,
      authorType: true,
      role: true,
      avatarUrl: true,
    },
    orderBy: { displayName: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-8 font-serif text-3xl font-bold">Users</h1>

      {users.length === 0 ? (
        <p className="text-sm text-muted">No users yet.</p>
      ) : (
        <div className="space-y-2" data-testid="users-list">
          {users.map((user) => (
            <Link
              key={user.githubLogin}
              href={`/users/${user.githubLogin}`}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3 hover:bg-border/20 no-underline"
              data-testid="user-row"
              data-login={user.githubLogin}
            >
              <div className="flex items-center gap-3">
                {user.avatarUrl && (
                  <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                )}
                <div>
                  <span className="font-medium text-foreground" data-testid="user-name">
                    {user.displayName}
                  </span>
                  <span className="ml-2 text-xs text-muted">
                    @{user.githubLogin}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
                  data-testid="user-type"
                >
                  {user.authorType}
                </span>
                <span
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
                  data-testid="user-role"
                >
                  {user.role}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
