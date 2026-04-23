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

  // Fetch all papers for this year and find the max sequence number numerically.
  // Lexicographic sort fails when IDs grow past 3 digits (999 > 1000 as strings).
  const papers = await prisma.paper.findMany({
    where: { paperId: { startsWith: prefix } },
    select: { paperId: true },
  });

  let maxSeq = 0;
  for (const p of papers) {
    const num = parseInt(p.paperId.split("-")[1], 10);
    if (!isNaN(num) && num > maxSeq) maxSeq = num;
  }

  const seq = maxSeq + 1;
  // Use minimum 3 digits, but grow naturally for >999 papers
  const width = Math.max(3, String(seq).length);
  return `${year}-${String(seq).padStart(width, "0")}`;
}
