/**
 * Search Sanitization — Pure Function Tests
 *
 * sanitizeQuery and validateCategory are the boundary guards
 * between user input and the SQL query. These tests verify
 * the OWASP-relevant properties: injection prevention,
 * special character handling, and allowlist enforcement.
 */

import { describe, test, expect } from "vitest";
import { sanitizeQuery, validateCategory } from "@/lib/search/sanitize";

// ═══════════════════════════════════════════════════════════
//  sanitizeQuery
// ═══════════════════════════════════════════════════════════

describe("sanitizeQuery", () => {
  test("passes through plain words", () => {
    expect(sanitizeQuery("category theory")).toBe("category theory");
  });

  test("preserves hyphens", () => {
    expect(sanitizeQuery("q-series")).toBe("q-series");
  });

  test("preserves unicode letters", () => {
    expect(sanitizeQuery("Möbius Weiß")).toBe("Möbius Weiß");
  });

  test("preserves digits", () => {
    expect(sanitizeQuery("theorem 2.7")).toBe("theorem 2 7");
  });

  test("strips SQL injection characters (preserves hyphens)", () => {
    // Hyphens are preserved by the regex, so -- survives as --
    expect(sanitizeQuery("'; DROP TABLE papers;--")).toBe("DROP TABLE papers --");
  });

  test("strips special characters", () => {
    expect(sanitizeQuery("!@#$%^&*()")).toBe("");
  });

  test("collapses multiple spaces", () => {
    expect(sanitizeQuery("  lots   of   spaces  ")).toBe("lots of spaces");
  });

  test("trims whitespace", () => {
    expect(sanitizeQuery("  hello  ")).toBe("hello");
  });

  test("empty string → empty string", () => {
    expect(sanitizeQuery("")).toBe("");
  });

  test("whitespace-only → empty string", () => {
    expect(sanitizeQuery("   ")).toBe("");
  });

  test("strips tsquery operators", () => {
    // These could manipulate Postgres tsquery if not sanitized
    expect(sanitizeQuery("foo & bar | !baz")).toBe("foo bar baz");
  });
});

// ═══════════════════════════════════════════════════════════
//  validateCategory
// ═══════════════════════════════════════════════════════════

describe("validateCategory", () => {
  test("accepts 'research'", () => {
    expect(validateCategory("research")).toBe("research");
  });

  test("accepts 'expository'", () => {
    expect(validateCategory("expository")).toBe("expository");
  });

  test("rejects unknown category", () => {
    expect(validateCategory("opinion")).toBeNull();
  });

  test("rejects empty string", () => {
    expect(validateCategory("")).toBeNull();
  });

  test("rejects undefined", () => {
    expect(validateCategory(undefined)).toBeNull();
  });

  test("rejects SQL injection in category", () => {
    expect(validateCategory("research'; DROP TABLE--")).toBeNull();
  });

  test("rejects case mismatch", () => {
    expect(validateCategory("Research")).toBeNull();
    expect(validateCategory("EXPOSITORY")).toBeNull();
  });
});
