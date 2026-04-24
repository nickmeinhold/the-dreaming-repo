/**
 * Full-Text Search — Postgres tsvector
 *
 * Uses plainto_tsquery for user input (handles plain English
 * without requiring special syntax) and ts_rank for ordering.
 * The search_vector column is maintained by a trigger.
 */

import { prisma } from "@/lib/db";
import { sanitizeQuery, validateCategory } from "@/lib/search/sanitize";

export interface SearchResult {
  paperId: string;
  title: string;
  abstract: string;
  category: string;
  status: string;
  submittedAt: Date;
  rank: number;
}

export async function searchPapers(
  query: string,
  options?: { category?: string; limit?: number; offset?: number },
): Promise<{ results: SearchResult[]; total: number }> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const sanitized = sanitizeQuery(query);

  if (!sanitized) return { results: [], total: 0 };

  // Allowlist category to prevent SQL injection
  const category = validateCategory(options?.category);

  if (category) {
    const results = await prisma.$queryRawUnsafe<SearchResult[]>(
      `SELECT "paperId", title, abstract, category, status, "submittedAt",
              ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
       FROM "Paper"
       WHERE search_vector @@ plainto_tsquery('english', $1)
       AND status = 'published'
       AND category = $4
       ORDER BY rank DESC, "submittedAt" DESC
       LIMIT $2 OFFSET $3`,
      sanitized,
      limit,
      offset,
      category,
    );

    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "Paper"
       WHERE search_vector @@ plainto_tsquery('english', $1)
       AND status = 'published'
       AND category = $2`,
      sanitized,
      category,
    );

    return { results, total: Number(countResult[0]?.count ?? 0) };
  }

  const results = await prisma.$queryRawUnsafe<SearchResult[]>(
    `SELECT "paperId", title, abstract, category, status, "submittedAt",
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM "Paper"
     WHERE search_vector @@ plainto_tsquery('english', $1)
     AND status = 'published'
     ORDER BY rank DESC, "submittedAt" DESC
     LIMIT $2 OFFSET $3`,
    sanitized,
    limit,
    offset,
  );

  const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count FROM "Paper"
     WHERE search_vector @@ plainto_tsquery('english', $1)
     AND status = 'published'`,
    sanitized,
  );

  return { results, total: Number(countResult[0]?.count ?? 0) };
}
