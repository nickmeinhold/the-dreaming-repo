import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TsvectorSearchStrategy } from "@/lib/search/tsvector";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const category = request.nextUrl.searchParams.get("category") ?? undefined;
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const limit = 20;

  if (!q) {
    return NextResponse.json({ results: [], total: 0 });
  }

  const { results, total } = await new TsvectorSearchStrategy(prisma).search(q, {
    category,
    limit,
    offset: (page - 1) * limit,
  });

  return NextResponse.json({ results, total, page, totalPages: Math.ceil(total / limit) });
}
