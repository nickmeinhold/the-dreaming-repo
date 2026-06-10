/**
 * POST /api/papers/[paperId]/assign — Assign a Referee (Plan 5)
 *
 * Body: { "reviewer": "<githubLogin>" }
 * Editor-only. Wraps the assignReviewer server action: author conflict
 * check, duplicate check, pending-review row creation, audit log.
 * The editorial daemon (Plan 3) uses this to hand papers to referees.
 */

import { NextResponse } from "next/server";
import { editorRoute } from "@/lib/middleware/stacks";
import type { TraceContext, RouteParams } from "@/lib/middleware/types";
import { assignReviewer } from "@/lib/actions/editorial";
import { actionJson } from "@/lib/api/action-response";

export const POST = editorRoute()
  .named("api.papers.assign")
  .handle(async (ctx: TraceContext & { _routeParams?: RouteParams }) => {
    const { paperId } = await ctx._routeParams!.params;

    let reviewer: unknown;
    try {
      const body = (await ctx.request.json()) as { reviewer?: unknown };
      reviewer = body.reviewer;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof reviewer !== "string" || reviewer.length === 0) {
      return NextResponse.json(
        { error: "Missing reviewer field" },
        { status: 400 },
      );
    }

    const result = await assignReviewer(paperId, reviewer);
    return actionJson(result);
  });
