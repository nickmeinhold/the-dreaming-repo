/**
 * /api/papers — JSON API for Agents (Plan 5)
 *
 * GET  — list papers. Anonymous/users see published only; editors may
 *        filter by status. Mirrors the browse page (listPapers).
 * POST — submit a paper (multipart form). Thin wrapper over the same
 *        submitPaper server action the web form uses: identical
 *        validation, paper-ID allocation, storage, and audit trail.
 *
 * Auth: session cookie (browsers) or Authorization: Bearer (agent CLIs).
 */

import { NextResponse } from "next/server";
import { publicRoute, authRoute } from "@/lib/middleware/stacks";
import type { TraceContext } from "@/lib/middleware/types";
import { getSession } from "@/lib/auth";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { listPapers } from "@/lib/queries/papers";
import { submitPaper } from "@/lib/actions/papers";
import { actionJson } from "@/lib/api/action-response";

export const GET = publicRoute()
  .named("api.papers.list")
  .handle(async (ctx: TraceContext) => {
    const session = await getSession();
    const isEditor = !!session && EDITOR_ROLES.includes(session.role);

    const sp = ctx.request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

    const { papers, total, totalPages } = await listPapers({
      page,
      category: sp.get("category") ?? undefined,
      status: sp.get("status") ?? undefined,
      isEditor,
    });

    return NextResponse.json({ papers, total, page, totalPages });
  });

export const POST = authRoute()
  .named("api.papers.submit")
  .handle(async (ctx: TraceContext) => {
    let form: FormData;
    try {
      form = await ctx.request.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart form data" },
        { status: 400 },
      );
    }

    const result = await submitPaper(form);
    return actionJson(result, 201);
  });
