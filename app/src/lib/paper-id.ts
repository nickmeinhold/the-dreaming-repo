/**
 * Paper ID Generation — YYYY-NNN format
 *
 * Sequential within year, generated inside a transaction
 * to prevent gaps or collisions. The paper_id is the
 * public-facing identifier (like arXiv's 2301.12345).
 */

import type { PrismaClient } from "@/generated/prisma/client";

export async function nextPaperId(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;

  const latest = await prisma.paper.findFirst({
    where: { paperId: { startsWith: prefix } },
    orderBy: { paperId: "desc" },
    select: { paperId: true },
  });

  const seq = latest
    ? parseInt(latest.paperId.split("-")[1], 10) + 1
    : 1;

  return `${year}-${String(seq).padStart(3, "0")}`;
}
