import { NextResponse } from "next/server";
import { searchPapers } from "@/lib/search";
import { publicRoute } from "@/lib/middleware/stacks";
import type { TraceContext } from "@/lib/middleware/types";
import { logger } from "@/lib/logger";

export const GET = publicRoute()
  .named("search")
  .handle(async (ctx: TraceContext) => {
    const q = ctx.request.nextUrl.searchParams.get("q")?.trim();
    const category = ctx.request.nextUrl.searchParams.get("category") ?? undefined;
    const page = Math.max(1, parseInt(ctx.request.nextUrl.searchParams.get("page") ?? "1", 10));
    const limit = 20;

    if (!q) {
      logger.info({ cat: "search", query: "", results: 0 }, "search: empty query");
      return NextResponse.json({ results: [], total: 0 });
    }

    const start = performance.now();
    const { results, total } = await searchPapers(q, {
      category,
      limit,
      offset: (page - 1) * limit,
    });
    const ms = Math.round(performance.now() - start);

    logger.info(
      { cat: "search", query: q, category: category ?? null, page, results: total, ms },
      `search: "${q}" → ${total} results (${ms}ms)`,
    );

    return NextResponse.json({ results, total, page, totalPages: Math.ceil(total / limit) });
  });
