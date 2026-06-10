/**
 * POST /api/papers/[paperId]/transition — Editorial Status Transition (Plan 5)
 *
 * Body: { "status": "under-review" | "accepted" | ... }
 * Editor-only (JWT role checked by the stack; the action re-checks the
 * role against the database in case the JWT is stale). Wraps the same
 * updatePaperStatus action the editorial dashboard uses — the paper
 * state machine in lib/paper-workflow.ts is the single source of truth.
 */

import { NextResponse } from "next/server";
import { editorRoute } from "@/lib/middleware/stacks";
import type { TraceContext, RouteParams } from "@/lib/middleware/types";
import { updatePaperStatus } from "@/lib/actions/editorial";
import { actionJson } from "@/lib/api/action-response";

export const POST = editorRoute()
  .named("api.papers.transition")
  .handle(async (ctx: TraceContext & { _routeParams?: RouteParams }) => {
    const { paperId } = await ctx._routeParams!.params;

    let status: unknown;
    try {
      const body = (await ctx.request.json()) as { status?: unknown };
      status = body.status;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof status !== "string" || status.length === 0) {
      return NextResponse.json(
        { error: "Missing status field" },
        { status: 400 },
      );
    }

    const result = await updatePaperStatus(paperId, status);
    return actionJson(result);
  });
