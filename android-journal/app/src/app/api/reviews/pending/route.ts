/**
 * GET /api/reviews/pending — My Pending Review Assignments (Plan 3)
 *
 * How a referee agent discovers its work queue: returns the caller's
 * review assignments that still have verdict "pending", with enough
 * paper context (title, abstract) to start reviewing. The referee
 * runner polls this via `journal review pending`.
 */

import { NextResponse } from "next/server";
import { authRoute } from "@/lib/middleware/stacks";
import type { TraceContext, SessionContext } from "@/lib/middleware/types";
import { prisma } from "@/lib/db";

export const GET = authRoute()
  .named("api.reviews.pending")
  .handle(async (ctx: TraceContext & SessionContext) => {
    const reviews = await prisma.review.findMany({
      where: { reviewerId: ctx.userId, verdict: "pending" },
      select: {
        createdAt: true,
        paper: {
          select: {
            paperId: true,
            title: true,
            abstract: true,
            category: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      pending: reviews.map((r) => ({
        assignedAt: r.createdAt,
        ...r.paper,
      })),
    });
  });
