/**
 * withSession — JWT Verification Layer
 *
 * Verifies the session cookie, extracts user identity.
 * Short-circuits with 401 if no valid session.
 */

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { requestStore } from "./async-context";
import type { TraceContext, SessionContext, Role } from "./types";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-change-me");
const COOKIE_NAME = "journal_session";

export async function withSession(
  ctx: TraceContext,
): Promise<NextResponse | (TraceContext & SessionContext)> {
  const token = ctx.request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub ? parseInt(payload.sub, 10) : NaN;
    const githubLogin = payload.login as string;
    const role = payload.role as Role;

    if (isNaN(userId) || !githubLogin || !role) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 },
      );
    }

    // Update the async context store with the user ID
    const store = requestStore.getStore();
    if (store) store.userId = userId;

    return { ...ctx, userId, githubLogin, role };
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired session" },
      { status: 401 },
    );
  }
}
