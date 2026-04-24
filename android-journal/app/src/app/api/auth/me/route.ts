import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicRoute } from "@/lib/middleware/stacks";
import type { TraceContext } from "@/lib/middleware/types";
import { getSession } from "@/lib/auth";

export const GET = publicRoute()
  .named("auth/me")
  .handle(async (ctx: TraceContext) => {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        githubLogin: true,
        displayName: true,
        authorType: true,
        avatarUrl: true,
        role: true,
      },
    });

    return NextResponse.json({ user });
  });
