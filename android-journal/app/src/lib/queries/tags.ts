import { prisma } from "@/lib/db";

export async function listTags() {
  return prisma.tag.findMany({
    include: {
      _count: { select: { papers: true } },
    },
    orderBy: { slug: "asc" },
  });
}

export async function getTagMetadata(slug: string) {
  return prisma.tag.findUnique({ where: { slug }, select: { label: true } });
}

export async function getTag(slug: string) {
  return prisma.tag.findUnique({
    where: { slug },
    include: {
      papers: {
        where: { paper: { status: "published" } },
        include: {
          paper: {
            include: {
              authors: {
                include: {
                  user: { select: { displayName: true, githubLogin: true } },
                },
                orderBy: { order: "asc" as const },
              },
              tags: {
                include: { tag: { select: { slug: true, label: true } } },
              },
            },
          },
        },
      },
    },
  });
}
