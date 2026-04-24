/**
 * Dev-Only Login — Bypass GitHub OAuth
 *
 * GET /api/auth/dev-login?user=RaggedR
 *
 * Looks up the user by githubLogin, creates a JWT session,
 * and redirects to /. Only available in development.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import type { Role } from "@/lib/middleware/types";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const login = request.nextUrl.searchParams.get("user");
  if (!login) {
    // List available users
    const users = await prisma.user.findMany({
      select: { githubLogin: true, displayName: true, role: true },
      orderBy: { displayName: "asc" },
    });
    return NextResponse.json({
      usage: "GET /api/auth/dev-login?user=<githubLogin>",
      users,
    });
  }

  const user = await prisma.user.findUnique({
    where: { githubLogin: login },
  });
  if (!user) {
    return NextResponse.json({ error: `User "${login}" not found` }, { status: 404 });
  }

  await createSession({
    userId: user.id,
    githubLogin: user.githubLogin,
    role: user.role as Role,
  });

  return NextResponse.redirect(new URL("/", request.url));
}
