/**
 * GET /api/auth/github/callback — GitHub OAuth Callback
 *
 * Exchanges the authorization code for an access token, then delegates
 * to loginWithGitHubToken (shared with the PAT exchange route) for
 * profile fetch, user upsert, and session creation.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loginWithGitHubToken } from "@/lib/auth/github-login";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

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

    const result = await loginWithGitHubToken(tokenData.access_token, "oauth", trace);
    if (result.isErr()) {
      return NextResponse.redirect(
        new URL("/?error=oauth_user_failed", request.nextUrl.origin),
      );
    }

    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  });
}
