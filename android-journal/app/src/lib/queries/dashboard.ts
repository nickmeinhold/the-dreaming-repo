import { prisma } from "@/lib/db";

export async function getUserRole(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
}

export async function getEditorialPapers() {
  return prisma.paper.findMany({
    where: { status: { not: "published" } },
    include: {
      authors: {
        include: { user: { select: { displayName: true, githubLogin: true } } },
        orderBy: { order: "asc" as const },
      },
      reviews: {
        select: {
          id: true,
          verdict: true,
          reviewer: { select: { displayName: true, githubLogin: true } },
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });
}
