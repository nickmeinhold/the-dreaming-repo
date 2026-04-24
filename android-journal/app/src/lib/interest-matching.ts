/**
 * Interest Matching — Jaccard Similarity
 *
 * Finds users with the most overlap in papers they've read.
 * similarity(A, B) = |read(A) ∩ read(B)| / |read(A) ∪ read(B)|
 *
 * Uses a simple SQL join for V1. For scale, precompute in a
 * materialized view refreshed on schedule.
 */

import { prisma } from "@/lib/db";

/** Pure Jaccard similarity: |A ∩ B| / |A ∪ B| */
export function jaccardSimilarity(setA: Set<number>, setB: Set<number>): number {
  const overlap = [...setA].filter((x) => setB.has(x)).length;
  const union = setA.size + setB.size - overlap;
  return union > 0 ? overlap / union : 0;
}

export interface SimilarUser {
  userId: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string | null;
  overlap: number;
  similarity: number;
}

export async function findSimilarUsers(
  userId: number,
  limit = 10,
): Promise<SimilarUser[]> {
  // Count how many papers this user has read
  const userReadCount = await prisma.download.count({
    where: { userId, read: true, paper: { status: "published" } },
  });

  if (userReadCount === 0) return [];

  // Find users with overlapping reads and compute Jaccard
  const results = await prisma.$queryRawUnsafe<
    {
      user_id: number;
      github_login: string;
      display_name: string;
      avatar_url: string | null;
      overlap: bigint;
      other_read_count: bigint;
    }[]
  >(
    `WITH user_reads AS (
       SELECT DISTINCT d."paperId" FROM "Download" d
       JOIN "Paper" p ON p.id = d."paperId" AND p.status = 'published'
       WHERE d."userId" = $1 AND d.read = true
     ),
     other_reads AS (
       SELECT d."userId", d."paperId" FROM "Download" d
       JOIN "Paper" p ON p.id = d."paperId" AND p.status = 'published'
       WHERE d."userId" != $1 AND d.read = true
       GROUP BY d."userId", d."paperId"
     )
     SELECT
       o."userId" as user_id,
       u."githubLogin" as github_login,
       u."displayName" as display_name,
       u."avatarUrl" as avatar_url,
       COUNT(*) as overlap,
       (SELECT COUNT(DISTINCT d2."paperId") FROM "Download" d2
        JOIN "Paper" p2 ON p2.id = d2."paperId" AND p2.status = 'published'
        WHERE d2."userId" = o."userId" AND d2.read = true) as other_read_count
     FROM other_reads o
     JOIN user_reads ur ON o."paperId" = ur."paperId"
     JOIN "User" u ON u.id = o."userId"
     GROUP BY o."userId", u."githubLogin", u."displayName", u."avatarUrl"
     ORDER BY COUNT(*) DESC
     LIMIT $2`,
    userId,
    limit,
  );

  return results.map((r) => {
    const overlap = Number(r.overlap);
    const otherCount = Number(r.other_read_count);
    const union = userReadCount + otherCount - overlap;
    return {
      userId: r.user_id,
      githubLogin: r.github_login,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      overlap,
      similarity: union > 0 ? overlap / union : 0,
    };
  });
}
