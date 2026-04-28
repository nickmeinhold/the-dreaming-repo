import { prisma } from "@/lib/db";

const PAGE_SIZE = 20;

export async function getPaperMetadata(paperId: string) {
  return prisma.paper.findFirst({
    where: { paperId, status: "published" },
    select: { title: true, abstract: true },
  });
}

export async function getPaper(paperId: string, isEditor: boolean) {
  return prisma.paper.findFirst({
    where: isEditor ? { paperId } : { paperId, status: "published" },
    include: {
      authors: {
        include: {
          user: {
            select: {
              displayName: true,
              githubLogin: true,
              authorType: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { order: "asc" },
      },
      tags: {
        include: { tag: { select: { slug: true, label: true } } },
      },
      reviews: {
        where: { visible: true },
        include: {
          reviewer: {
            select: { displayName: true, githubLogin: true },
          },
        },
      },
      notes: {
        where: { parentId: null },
        include: {
          user: { select: { displayName: true, githubLogin: true, avatarUrl: true } },
          replies: {
            include: {
              user: { select: { displayName: true, githubLogin: true, avatarUrl: true } },
              replies: {
                include: {
                  user: { select: { displayName: true, githubLogin: true, avatarUrl: true } },
                  replies: {
                    include: {
                      user: { select: { displayName: true, githubLogin: true, avatarUrl: true } },
                    },
                    orderBy: { createdAt: "asc" as const },
                  },
                },
                orderBy: { createdAt: "asc" as const },
              },
            },
            orderBy: { createdAt: "asc" as const },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { notes: true, downloads: true, favourites: true },
      },
    },
  });
}

export async function getPaperUserState(paperDbId: number, userId: number) {
  const [fav, dl] = await Promise.all([
    prisma.favourite.findUnique({
      where: { paperId_userId: { paperId: paperDbId, userId } },
    }),
    prisma.download.findFirst({
      where: { paperId: paperDbId, userId, read: true },
    }),
  ]);
  return { isFavourited: !!fav, hasRead: !!dl };
}

export interface ListPapersOpts {
  page: number;
  category?: string;
  status?: string;
  isEditor: boolean;
}

export async function listPapers({ page, category, status, isEditor }: ListPapersOpts) {
  const statusFilter =
    status && isEditor ? { status } : { status: "published" };

  const where = {
    ...(category && { category }),
    ...statusFilter,
  };

  const [papers, total] = await Promise.all([
    prisma.paper.findMany({
      where,
      include: {
        authors: {
          include: { user: { select: { displayName: true, githubLogin: true } } },
          orderBy: { order: "asc" as const },
        },
        tags: {
          include: { tag: { select: { slug: true, label: true } } },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.paper.count({ where }),
  ]);

  return { papers, total, totalPages: Math.ceil(total / PAGE_SIZE) };
}
