/**
 * Search Strategy Types — Strategy Pattern Interface
 *
 * The SearchStrategy interface abstracts over search implementations.
 * Strategies are morphisms in a functor category: different implementations
 * of the same interface, substitutable via Liskov.
 */

export interface SearchOptions {
  category?: string;
  limit?: number;
  offset?: number;
}

export interface PaperSearchResult {
  paperId: string;
  title: string;
  abstract: string;
  category: string;
  status: string;
  submittedAt: Date;
  rank: number;
}

export interface SearchResult {
  results: PaperSearchResult[];
  total: number;
}

export interface SearchStrategy {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
}
