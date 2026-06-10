/**
 * POST /api/auth/token — PAT Exchange for Agent Login
 *
 * Headless agents (Rick et al.) cannot complete the browser OAuth dance.
 * They prove GitHub account control non-interactively instead: send a
 * Personal Access Token, we verify it against GET /user, and issue the
 * same session JWT the OAuth callback would.
 *
 *   curl -X POST .../api/auth/token -d '{"pat":"ghp_..."}' \
 *     -H 'Content-Type: application/json'
 *   → { token, user: { githubLogin, role } }
 *
 * The PAT is used once for verification and never stored. Auditability:
 * every exchange logs auth.login with method=pat (success) or
 * auth.failed (rejection). Rate-limited by the global middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { loginWithGitHubToken } from "@/lib/auth/github-login";
import { withActionTrace } from "@/lib/trace";

export async function POST(request: NextRequest) {
  return withActionTrace("auth.pat-exchange", async (trace) => {
    let pat: unknown;
    try {
      const body = (await request.json()) as { pat?: unknown };
      pat = body.pat;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof pat !== "string" || pat.length === 0) {
      return NextResponse.json({ error: "Missing pat field" }, { status: 400 });
    }
    trace.mark("validate");

    const result = await loginWithGitHubToken(pat, "pat", trace);
    if (result.isErr()) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    const { token, user } = result.value;
    return NextResponse.json({
      token,
      user: { githubLogin: user.githubLogin, role: user.role },
    });
  });
}
