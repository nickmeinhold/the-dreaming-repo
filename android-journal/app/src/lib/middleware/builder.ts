/**
 * Route Builder — Kleisli Composition via Fluent API
 *
 * Ported from the CRM. Composes middleware layers into a single
 * route handler. Each .use() adds a Kleisli arrow to the chain.
 * The .handle() call terminates with a handler.
 *
 * Logs every API route completion: method, path, status, duration, userId.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Middleware, Handler, RouteHandler, RouteParams } from "./types";
import { logger } from "@/lib/logger";
import { logAuditEvent } from "@/lib/audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMiddleware = Middleware<any, any>;

export class RouteBuilder<Ctx> {
  private middlewares: AnyMiddleware[] = [];
  private label = "route";

  use<Added>(
    mw: Middleware<Ctx, Ctx & Added>,
  ): RouteBuilder<Ctx & Added> {
    const next = new RouteBuilder<Ctx & Added>();
    next.middlewares = [...this.middlewares, mw as AnyMiddleware];
    next.label = this.label;
    return next;
  }

  named(name: string): RouteBuilder<Ctx> {
    const next = new RouteBuilder<Ctx>();
    next.middlewares = [...this.middlewares];
    next.label = name;
    return next;
  }

  handle(handler: Handler<Ctx>): RouteHandler {
    const mws = [...this.middlewares];
    const routeLabel = this.label;

    return async (
      request: NextRequest,
      routeContext?: RouteParams,
    ): Promise<NextResponse> => {
      const start = performance.now();
      const method = request.method ?? "UNKNOWN";
      const path = request.nextUrl?.pathname ?? "/";

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ctx: any = { request, _routeParams: routeContext };

        for (const mw of mws) {
          const result = await mw(ctx);
          if (result instanceof NextResponse) {
            const ms = Math.round(performance.now() - start);
            const status = result.status;
            logger.info(
              { cat: "route", method, path, status, ms, route: routeLabel },
              `${method} ${path} ${status} ${ms}ms`,
            );
            return result;
          }
          ctx = result;
        }

        // userId is set by withSession — no need to duplicate here
        const response = await handler(ctx);
        const ms = Math.round(performance.now() - start);
        const status = response.status;
        logger.info(
          { cat: "route", method, path, status, ms, route: routeLabel },
          `${method} ${path} ${status} ${ms}ms`,
        );
        return response;
      } catch (error) {
        const ms = Math.round(performance.now() - start);
        logger.error(
          { cat: "route", err: error, method, path, status: 500, ms, route: routeLabel },
          `${method} ${path} 500 ${ms}ms`,
        );
        logAuditEvent({
          action: "system.error",
          entity: "system",
          entityId: routeLabel,
          details: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    };
  }
}

export function route(): RouteBuilder<{ request: NextRequest; _routeParams?: RouteParams }> {
  return new RouteBuilder();
}
