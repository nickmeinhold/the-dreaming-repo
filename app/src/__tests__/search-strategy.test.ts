/**
 * Search Strategy — Substitutability and Pure Function Tests
 *
 * CATEGORY THEORY:
 *   Strategies are morphisms in a functor category — different implementations
 *   of the same interface. Liskov substitutability is the categorical condition
 *   that the morphism respects the interface's structure.
 *
 * DESIGN PATTERNS (GoF):
 *   Strategy — encapsulate search algorithms behind a common interface
 *
 * Tests the pure functions (sanitize, validateCategory) directly,
 * and the TsvectorSearchStrategy against a mock Prisma client.
 */

import { describe, it, expect } from "vitest";
import { sanitizeQuery, validateCategory } from "@/lib/search/sanitize";
import { TsvectorSearchStrategy } from "@/lib/search/tsvector";
import type { SearchStrategy } from "@/lib/search/types";

// ── Mock Prisma client ──────────────────────────────────────

function mockPrisma(results: unknown[] = [], count: bigint = 0n) {
  return {
    $queryRawUnsafe: async (...args: unknown[]) => {
      const sql = args[0] as string;
      if (sql.includes("COUNT(*)")) return [{ count }];
      return results;
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ═══════════════════════════════════════════════════════════
//  INTERFACE COMPLIANCE
// ═══════════════════════════════════════════════════════════

describe("Interface Compliance", () => {
  it("TsvectorSearchStrategy implements SearchStrategy", () => {
    const strategy: SearchStrategy = new TsvectorSearchStrategy(mockPrisma());
    expect(strategy.search).toBeDefined();
    expect(typeof strategy.search).toBe("function");
  });

  it("empty sanitized query returns { results: [], total: 0 }", async () => {
    const strategy = new TsvectorSearchStrategy(mockPrisma());
    const result = await strategy.search("");
    expect(result).toEqual({ results: [], total: 0 });
  });
});

// ═══════════════════════════════════════════════════════════
//  SANITIZATION (pure function tests)
// ═══════════════════════════════════════════════════════════

describe("Query Sanitization", () => {
  it("strips special characters, preserves words", () => {
    expect(sanitizeQuery("hello world!")).toBe("hello world");
    expect(sanitizeQuery("category-theory")).toBe("category-theory");
    expect(sanitizeQuery("(foo) [bar] {baz}")).toBe("foo bar baz");
  });

  it("trims whitespace", () => {
    expect(sanitizeQuery("  hello  ")).toBe("hello");
  });

  it("multiple spaces collapse", () => {
    expect(sanitizeQuery("hello    world")).toBe("hello world");
  });

  it("query with ONLY special characters → empty string", () => {
    expect(sanitizeQuery("!@#$%^&*()")).toBe("");
    expect(sanitizeQuery("...")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════
//  CATEGORY VALIDATION
// ═══════════════════════════════════════════════════════════

describe("Category Validation", () => {
  it("'research' → 'research' (valid)", () => {
    expect(validateCategory("research")).toBe("research");
  });

  it("'expository' → 'expository' (valid)", () => {
    expect(validateCategory("expository")).toBe("expository");
  });

  it("'invalid' → null (rejected)", () => {
    expect(validateCategory("invalid")).toBeNull();
  });

  it("undefined → null", () => {
    expect(validateCategory(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  STRATEGY CONTRACT
// ═══════════════════════════════════════════════════════════

describe("Strategy Contract", () => {
  it("result has 'results' array and 'total' number", async () => {
    const mockResults = [
      { paperId: "2026-001", title: "Test", abstract: "...", category: "research",
        status: "published", submittedAt: new Date(), rank: 0.5 },
    ];
    const strategy = new TsvectorSearchStrategy(mockPrisma(mockResults, 1n));
    const result = await strategy.search("test");

    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("total is non-negative integer", async () => {
    const strategy = new TsvectorSearchStrategy(mockPrisma([], 0n));
    const result = await strategy.search("test");

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.total)).toBe(true);
  });
});
