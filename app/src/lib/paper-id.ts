/**
 * Paper ID Generation — YYYY-NNN format
 *
 * Sequential within year. Must be called inside a transaction
 * to prevent race conditions on concurrent submissions.
 */

// Accepts either PrismaClient or a transaction client ($transaction callback argument)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextPaperId(prisma: { paper: any }): Promise<string> {
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

  // Use minimum 3 digits, but grow naturally for >999 papers
  const width = Math.max(3, String(seq).length);
  return `${year}-${String(seq).padStart(width, "0")}`;
}
