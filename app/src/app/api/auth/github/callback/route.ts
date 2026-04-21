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
import { GitHubAuthAdapter } from "@/lib/auth/adapter";
import type { GitHubUser } from "@/lib/auth/adapter";

const adapter = new GitHubAuthAdapter();

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Verify state to prevent CSRF
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value;
  cookieStore.delete("oauth_state");

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/?error=oauth_failed", request.nextUrl.origin),
    );
  }

  // Exchange code for access token
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
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
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!tokenResponse.ok) {
    return NextResponse.redirect(
      new URL("/?error=oauth_token_failed", request.nextUrl.origin),
    );
  }

  const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
  if (!tokenData.access_token) {
    return NextResponse.redirect(
      new URL("/?error=oauth_token_failed", request.nextUrl.origin),
    );
  }

  // Fetch GitHub user profile
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!userResponse.ok) {
    return NextResponse.redirect(
      new URL("/?error=oauth_user_failed", request.nextUrl.origin),
    );
  }

  const githubUser = (await userResponse.json()) as GitHubUser;
  if (!githubUser.id) {
    return NextResponse.redirect(
      new URL("/?error=oauth_user_failed", request.nextUrl.origin),
    );
  }

  // Create or update user via auth adapter
  const upsertData = adapter.toJournalUser(githubUser);
  const user = await prisma.user.upsert({
    where: { githubId: upsertData.githubId },
    update: {
      githubLogin: upsertData.githubLogin,
      avatarUrl: upsertData.avatarUrl,
      bio: upsertData.bio,
    },
    create: {
      ...upsertData,
    },
  });

  // Create session
  await createSession({
    userId: user.id,
    githubLogin: user.githubLogin,
    role: user.role as "user" | "editor" | "admin",
  });

  return NextResponse.redirect(new URL("/", request.nextUrl.origin));
}
