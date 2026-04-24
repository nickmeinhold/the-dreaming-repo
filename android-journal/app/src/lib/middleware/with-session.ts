/**
 * withSession — JWT Verification Layer
 *
 * Verifies the session cookie, extracts user identity.
 * Short-circuits with 401 if no valid session.
 */

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getJwtSecret, COOKIE_NAME } from "@/lib/constants";
import { requestStore } from "./async-context";
import { VALID_ROLES } from "./types";
import type { TraceContext, SessionContext, Role } from "./types";

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
    const { payload } = await jwtVerify(token, getJwtSecret());
    const userId = payload.sub ? parseInt(payload.sub, 10) : NaN;
    const githubLogin = payload.login as string;
    const role = payload.role as Role;

    if (isNaN(userId) || !githubLogin || !role || !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 },
      );
    }

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
