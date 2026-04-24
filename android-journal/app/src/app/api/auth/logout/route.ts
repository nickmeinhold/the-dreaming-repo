import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { authRoute } from "@/lib/middleware/stacks";
import type { TraceContext, SessionContext } from "@/lib/middleware/types";

export const POST = authRoute()
  .named("auth/logout")
  .handle(async (_ctx: TraceContext & SessionContext) => {
    await clearSession();
    return NextResponse.json({ ok: true });
  });
