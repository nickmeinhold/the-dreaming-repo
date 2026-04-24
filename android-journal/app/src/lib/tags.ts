/**
 * Tag Utilities — Slug ↔ Label Conversions
 *
 * slugToLabel and labelToSlug form a Galois connection (adjunction):
 *   labelToSlug ⊣ slugToLabel
 * with labelToSlug as left adjoint (free) and slugToLabel as right (forgetful).
 */

/** Convert a hyphenated slug to a Title Case label. */
export function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
