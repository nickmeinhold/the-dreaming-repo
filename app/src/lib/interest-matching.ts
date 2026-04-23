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
    where: { userId, read: true },
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
       SELECT DISTINCT "paperId" FROM "Download"
       WHERE "userId" = $1 AND read = true
     ),
     other_reads AS (
       SELECT "userId", "paperId" FROM "Download"
       WHERE "userId" != $1 AND read = true
       GROUP BY "userId", "paperId"
     )
     SELECT
       o."userId" as user_id,
       u."githubLogin" as github_login,
       u."displayName" as display_name,
       u."avatarUrl" as avatar_url,
       COUNT(*) as overlap,
       (SELECT COUNT(DISTINCT "paperId") FROM "Download"
        WHERE "userId" = o."userId" AND read = true) as other_read_count
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
