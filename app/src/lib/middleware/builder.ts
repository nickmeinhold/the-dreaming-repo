/**
 * Route Builder — Kleisli Composition via Fluent API
 *
 * Ported from the CRM. Composes middleware layers into a single
 * route handler. Each .use() adds a Kleisli arrow to the chain.
 * The .handle() call terminates with a handler.
 */

import { NextRequest, NextResponse } from "next/server";
import { requestStore } from "./async-context";
import type { Middleware, Handler, RouteHandler, RouteParams } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMiddleware = Middleware<any, any>;

export class RouteBuilder<Ctx> {
  private middlewares: AnyMiddleware[] = [];
  private label = "route";

  use<Added>(
    mw: Middleware<Ctx, Ctx & Added>,
  ): RouteBuilder<Ctx & Added> {
    this.middlewares.push(mw as AnyMiddleware);
    return this as unknown as RouteBuilder<Ctx & Added>;
  }

  named(name: string): this {
    this.label = name;
    return this;
  }

  handle(handler: Handler<Ctx>): RouteHandler {
    const mws = [...this.middlewares];
    const routeLabel = this.label;

    return async (
      request: NextRequest,
      routeContext?: RouteParams,
    ): Promise<NextResponse> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ctx: any = { request, _routeParams: routeContext };

        for (const mw of mws) {
          const result = await mw(ctx);
          if (result instanceof NextResponse) return result;
          ctx = result;
        }

        const store = requestStore.getStore();
        if (store && "userId" in ctx) {
          store.userId = (ctx as { userId: number }).userId;
        }

        return await handler(ctx);
      } catch (error) {
        console.error(`[${routeLabel}]`, error);
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
