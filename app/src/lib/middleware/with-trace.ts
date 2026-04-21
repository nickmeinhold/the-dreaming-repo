/**
 * withTrace — Base Context Layer
 *
 * Creates TraceContext with correlation ID, client IP, user-agent.
 * Initialises AsyncLocalStorage for the request.
 */

import type { NextRequest } from "next/server";
import { requestStore } from "./async-context";
import type { TraceContext, RouteParams } from "./types";

function getClientIp(request: NextRequest): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

export async function withTrace(
  ctx: { request: NextRequest; _routeParams?: RouteParams },
): Promise<TraceContext & { _routeParams?: RouteParams }> {
  const correlationId = crypto.randomUUID();

  requestStore.enterWith({ correlationId, userId: null });

  return {
    request: ctx.request,
    _routeParams: ctx._routeParams,
    correlationId,
    ip: getClientIp(ctx.request),
    userAgent: ctx.request.headers.get("user-agent") ?? undefined,
  };
}
