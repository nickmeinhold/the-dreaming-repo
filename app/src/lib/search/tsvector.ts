/**
 * Tsvector Search Strategy — PostgreSQL Full-Text Search
 *
 * Wraps the existing tsvector-based search in the SearchStrategy interface.
 * Uses plainto_tsquery for user input and ts_rank for ordering.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { sanitizeQuery, validateCategory } from "./sanitize";
import type { SearchStrategy, SearchOptions, SearchResult, PaperSearchResult } from "./types";

export class TsvectorSearchStrategy implements SearchStrategy {
  constructor(private readonly prisma: PrismaClient) {}

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const sanitized = sanitizeQuery(query);
    if (!sanitized) return { results: [], total: 0 };

    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const category = validateCategory(options?.category);

    if (category) {
      return this.searchWithCategory(sanitized, category, limit, offset);
    }
    return this.searchAll(sanitized, limit, offset);
  }

  private async searchWithCategory(
    sanitized: string,
    category: string,
    limit: number,
    offset: number,
  ): Promise<SearchResult> {
    const results = await this.prisma.$queryRawUnsafe<PaperSearchResult[]>(
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

    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "Paper"
       WHERE search_vector @@ plainto_tsquery('english', $1)
       AND status = 'published'
       AND category = $2`,
      sanitized,
      category,
    );

    return { results, total: Number(countResult[0]?.count ?? 0) };
  }

  private async searchAll(
    sanitized: string,
    limit: number,
    offset: number,
  ): Promise<SearchResult> {
    const results = await this.prisma.$queryRawUnsafe<PaperSearchResult[]>(
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

    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "Paper"
       WHERE search_vector @@ plainto_tsquery('english', $1)
       AND status = 'published'`,
      sanitized,
    );

    return { results, total: Number(countResult[0]?.count ?? 0) };
  }
}
