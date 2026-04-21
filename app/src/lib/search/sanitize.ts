/**
 * Search Sanitization — Pure Functions
 *
 * Extracted from search.ts for independent testability.
 * These are pure functions with no I/O dependencies.
 */

const VALID_CATEGORIES = ["research", "expository"] as const;

/**
 * Strip special characters from a search query, preserving words.
 * Collapses multiple spaces. Trims whitespace.
 */
export function sanitizeQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate a category filter. Returns the category if valid, null otherwise.
 * Acts as a guard: only allowlisted values pass through.
 */
export function validateCategory(
  category?: string,
): (typeof VALID_CATEGORIES)[number] | null {
  if (
    category &&
    (VALID_CATEGORIES as readonly string[]).includes(category)
  ) {
    return category as (typeof VALID_CATEGORIES)[number];
  }
  return null;
}
