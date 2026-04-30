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
  // Reuse incoming correlation ID if present (e.g. from GUI CLI's
  // X-Correlation-Id header), otherwise generate a fresh one.
  const correlationId =
    ctx.request.headers.get("x-correlation-id") || crypto.randomUUID();
  const batchId =
    ctx.request.headers.get("x-batch-id") || undefined;

  requestStore.enterWith({ correlationId, userId: null, batchId });

  return {
    request: ctx.request,
    _routeParams: ctx._routeParams,
    correlationId,
    ip: getClientIp(ctx.request),
    userAgent: ctx.request.headers.get("user-agent") ?? undefined,
  };
}
