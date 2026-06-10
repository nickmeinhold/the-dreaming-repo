/**
 * GitHub Token Login — Shared by OAuth Callback and PAT Exchange
 *
 * Given any GitHub access token (OAuth access_token or Personal Access
 * Token), verifies it against GET /user, upserts the journal User, and
 * creates a session. The two auth routes differ only in how the token
 * was obtained; everything after is identical and lives here.
 */

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { GitHubAuthAdapter, type GitHubUser } from "@/lib/auth/adapter";
import { logAuditEvent } from "@/lib/audit";
import { ok, err, type Result } from "@/lib/result";
import type { TraceRecorder } from "@/lib/trace";

const adapter = new GitHubAuthAdapter();

/**
 * Best-effort primary verified email lookup. GET /user only includes the
 * public email; /user/emails needs the user:email scope (OAuth requests
 * it; PATs may lack it). Any failure → null, never an error.
 */
async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    return emails.find((e) => e.primary && e.verified)?.email ?? null;
  } catch {
    return null;
  }
}

export interface LoginOutcome {
  token: string;
  user: { id: number; githubLogin: string; role: string };
}

/**
 * Verify a GitHub access token, upsert the user, create a session.
 * @param method audit-log discriminator: "oauth" | "pat"
 */
export async function loginWithGitHubToken(
  accessToken: string,
  method: "oauth" | "pat",
  trace: TraceRecorder,
): Promise<Result<LoginOutcome>> {
  // Fetch GitHub user profile
  const userResponse = await trace.step("user-fetch", () =>
    fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }),
  );

  if (!userResponse.ok) {
    trace.fail("user-validate", `github /user returned ${userResponse.status}`);
    logAuditEvent({
      action: "auth.failed",
      entity: "user",
      entityId: "unknown",
      details: JSON.stringify({ method, status: userResponse.status }),
    });
    return err("GitHub token verification failed");
  }

  const githubUser = (await userResponse.json()) as GitHubUser;
  if (!githubUser.id) {
    trace.fail("user-validate", "no id in github response");
    return err("GitHub token verification failed");
  }
  trace.mark("user-validate");

  const upsertData = adapter.toJournalUser(githubUser);

  const email =
    upsertData.email ??
    (await trace.step("email-fetch", () => fetchPrimaryEmail(accessToken)));

  const user = await trace.step("db-upsert", () =>
    prisma.user.upsert({
      where: { githubId: upsertData.githubId },
      update: {
        githubLogin: upsertData.githubLogin,
        avatarUrl: upsertData.avatarUrl,
        bio: upsertData.bio,
        // never null out a manually-set address on login
        ...(email ? { email } : {}),
      },
      create: {
        githubId: upsertData.githubId,
        githubLogin: upsertData.githubLogin,
        displayName: upsertData.displayName,
        authorType: upsertData.authorType,
        avatarUrl: upsertData.avatarUrl,
        bio: upsertData.bio,
        email,
      },
    }),
  );

  const token = await trace.step("session-create", () =>
    createSession({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: user.role as "user" | "editor" | "admin",
    }),
  );

  logAuditEvent({
    action: "auth.login",
    entity: "user",
    entityId: String(user.id),
    details: JSON.stringify({ githubLogin: user.githubLogin, method }),
  });
  trace.mark("audit");

  return ok({
    token,
    user: { id: user.id, githubLogin: user.githubLogin, role: user.role },
  });
}
