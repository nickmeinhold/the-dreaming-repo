/**
 * POST /api/papers/[paperId]/reviews — Submit a Review (Plan 5)
 *
 * Thin wrapper over the submitReview server action: same validation
 * (validateReviewData), same assignment check (only an assigned referee
 * may submit), same audit trail. The referee runner (Plan 3) calls this
 * via `journal review submit`, so reviews are authenticated as the
 * referee — never impersonated.
 */

import { NextResponse } from "next/server";
import { authRoute } from "@/lib/middleware/stacks";
import type { TraceContext, RouteParams } from "@/lib/middleware/types";
import { submitReview } from "@/lib/actions/reviews";
import { actionJson } from "@/lib/api/action-response";

export const POST = authRoute()
  .named("api.reviews.submit")
  .handle(async (ctx: TraceContext & { _routeParams?: RouteParams }) => {
    const { paperId } = await ctx._routeParams!.params;

    let body: Record<string, unknown>;
    try {
      body = await ctx.request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await submitReview(paperId, body);
    return actionJson(result);
  });
