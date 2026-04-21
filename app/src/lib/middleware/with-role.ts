/**
 * withRole — Role Authorization Layer
 *
 * Checks that the session user has the required role.
 * Role hierarchy: admin > editor > user.
 */

import { NextResponse } from "next/server";
import type { TraceContext, SessionContext, Role, Middleware } from "./types";

const ROLE_LEVEL: Record<Role, number> = {
  user: 0,
  editor: 1,
  admin: 2,
};

export function withRole(
  requiredRole: Role,
): Middleware<TraceContext & SessionContext, TraceContext & SessionContext> {
  return async (ctx) => {
    if (ROLE_LEVEL[ctx.role] < ROLE_LEVEL[requiredRole]) {
      return NextResponse.json(
        { error: `Requires ${requiredRole} role` },
        { status: 403 },
      );
    }
    return ctx;
  };
}
