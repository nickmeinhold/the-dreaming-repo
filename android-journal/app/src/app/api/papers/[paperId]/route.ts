/**
 * GET /api/papers/[paperId] — Paper Detail (Plan 5)
 *
 * Same visibility rule as the paper page: non-editors see published
 * papers only; editors see everything. 404 covers both "does not
 * exist" and "not visible to you" — no information leak.
 */

import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/middleware/stacks";
import type { TraceContext, RouteParams } from "@/lib/middleware/types";
import { getSession } from "@/lib/auth";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { getPaper } from "@/lib/queries/papers";

export const GET = publicRoute()
  .named("api.papers.show")
  .handle(async (ctx: TraceContext & { _routeParams?: RouteParams }) => {
    const { paperId } = await ctx._routeParams!.params;

    const session = await getSession();
    const isEditor = !!session && EDITOR_ROLES.includes(session.role);

    const paper = await getPaper(paperId, isEditor);
    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    return NextResponse.json({ paper });
  });
