import { prisma } from "@/lib/db";

export async function getUserMetadata(login: string) {
  return prisma.user.findUnique({
    where: { githubLogin: login },
    select: { displayName: true },
  });
}

export async function getUserProfile(login: string) {
  return prisma.user.findUnique({
    where: { githubLogin: login },
    include: {
      authorships: {
        include: {
          paper: {
            select: {
              paperId: true,
              title: true,
              status: true,
              category: true,
              submittedAt: true,
            },
          },
        },
        orderBy: { paper: { submittedAt: "desc" } },
      },
      reviews: {
        where: { visible: true },
        include: {
          paper: {
            select: { paperId: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      favourites: {
        where: { paper: { status: "published" } },
        include: {
          paper: {
            select: { paperId: true, title: true, category: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      downloads: {
        where: { read: true, paper: { status: "published" } },
        include: {
          paper: {
            select: { paperId: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}
