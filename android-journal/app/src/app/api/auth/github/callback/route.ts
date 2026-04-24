/**
 * GET /api/auth/github/callback — GitHub OAuth Callback
 *
 * Exchanges the authorization code for an access token,
 * fetches the GitHub user profile, creates or updates
 * the User record, and sets a session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { GitHubAuthAdapter, type GitHubUser } from "@/lib/auth/adapter";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

const adapter = new GitHubAuthAdapter();

export async function GET(request: NextRequest) {
  return withActionTrace("auth.github-callback", async (trace) => {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    // Verify state to prevent CSRF
    const cookieStore = await cookies();
    const storedState = cookieStore.get("oauth_state")?.value;
    cookieStore.delete("oauth_state");

    if (!code || !state || state !== storedState) {
      trace.fail("state-check", "mismatch or missing code");
      logAuditEvent({
        action: "auth.failed",
        entity: "user",
        entityId: "unknown",
        details: "OAuth state mismatch or missing code",
      });
      return NextResponse.redirect(
        new URL("/?error=oauth_failed", request.nextUrl.origin),
      );
    }
    trace.mark("state-check");

    // Exchange code for access token
    const tokenResponse = await trace.step("token-exchange", () =>
      fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      }),
    );

    const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
    if (!tokenData.access_token) {
      trace.fail("token-validate", "no access_token in response");
      logAuditEvent({
        action: "auth.failed",
        entity: "user",
        entityId: "unknown",
        details: "GitHub token exchange failed",
      });
      return NextResponse.redirect(
        new URL("/?error=oauth_token_failed", request.nextUrl.origin),
      );
    }
    trace.mark("token-validate");

    // Fetch GitHub user profile
    const userResponse = await trace.step("user-fetch", () =>
      fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }),
    );

    const githubUser = (await userResponse.json()) as GitHubUser;
    if (!githubUser.id) {
      trace.fail("user-validate", "no id in github response");
      return NextResponse.redirect(
        new URL("/?error=oauth_user_failed", request.nextUrl.origin),
      );
    }
    trace.mark("user-validate");

    const upsertData = adapter.toJournalUser(githubUser);

    const user = await trace.step("db-upsert", () =>
      prisma.user.upsert({
        where: { githubId: upsertData.githubId },
        update: {
          githubLogin: upsertData.githubLogin,
          avatarUrl: upsertData.avatarUrl,
          bio: upsertData.bio,
        },
        create: {
          githubId: upsertData.githubId,
          githubLogin: upsertData.githubLogin,
          displayName: upsertData.displayName,
          authorType: upsertData.authorType,
          avatarUrl: upsertData.avatarUrl,
          bio: upsertData.bio,
        },
      }),
    );

    await trace.step("session-create", () =>
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
      details: JSON.stringify({ githubLogin: user.githubLogin }),
    });
    trace.mark("audit");

    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  });
}
