/**
 * Search Sanitization — Pure Functions
 *
 * Extracted for independent testability.
 * These are pure functions with no I/O dependencies.
 */

import { VALID_CATEGORIES } from "@/lib/constants";

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
