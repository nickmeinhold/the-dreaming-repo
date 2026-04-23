/**
 * Jaccard Similarity — Metric Space Axioms
 *
 * CATEGORY THEORY:
 *   Jaccard distance d(A,B) = 1 - J(A,B) is a metric on finite sets.
 *   The space of users-by-read-sets, equipped with Jaccard distance,
 *   forms a metric space — a category enriched over ([0,∞], ≥, +).
 *
 *   This file tests the metric axioms directly on the formula used in
 *   interest-matching.ts (lines 71-83). The formula is:
 *     overlap = |A ∩ B|
 *     union = |A| + |B| - overlap   (inclusion-exclusion)
 *     J(A,B) = union > 0 ? overlap / union : 0
 *
 *   Axioms tested:
 *     - Symmetry: J(A,B) = J(B,A)
 *     - Identity: J(A,A) = 1
 *     - Bounds: 0 ≤ J(A,B) ≤ 1
 *     - Empty set convention: J(∅,A) = 0, J(∅,∅) = 0
 *     - Monotonicity: more overlap → higher similarity
 *     - Subset property: A ⊆ B → J(A,B) = |A|/|B|
 *     - Triangle inequality on d(A,B) = 1 - J(A,B)
 */

import { describe, it, expect } from "vitest";

// ── Pure Jaccard (mirrors interest-matching.ts logic) ─────

function jaccard(setA: Set<number>, setB: Set<number>): number {
  const overlap = [...setA].filter((x) => setB.has(x)).length;
  const union = setA.size + setB.size - overlap;
  return union > 0 ? overlap / union : 0;
}

function jaccardDistance(a: Set<number>, b: Set<number>): number {
  return 1 - jaccard(a, b);
}

// ── Test sets ─────────────────────────────────────────────

const A = new Set([1, 2, 3, 4]);
const B = new Set([3, 4, 5, 6]);
const C = new Set([5, 6, 7, 8]);
const D = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const empty = new Set<number>();

// ═══════════════════════════════════════════════════════════
//  SIMILARITY PROPERTIES
// ═══════════════════════════════════════════════════════════

describe("Jaccard Similarity Properties", () => {
  describe("Symmetry: J(A,B) = J(B,A)", () => {
    it("holds for overlapping sets", () => {
      expect(jaccard(A, B)).toBe(jaccard(B, A));
    });

    it("holds for disjoint sets", () => {
      expect(jaccard(A, C)).toBe(jaccard(C, A));
    });

    it("holds for subset/superset", () => {
      expect(jaccard(A, D)).toBe(jaccard(D, A));
    });

    it("holds for empty set", () => {
      expect(jaccard(empty, A)).toBe(jaccard(A, empty));
    });
  });

  describe("Identity: J(A,A) = 1 for non-empty A", () => {
    it.each([
      ["A", A],
      ["B", B],
      ["C", C],
      ["D", D],
    ] as const)("J(%s,%s) = 1", (_, set) => {
      expect(jaccard(set, set)).toBe(1);
    });
  });

  describe("Empty set convention", () => {
    it("J(∅,A) = 0", () => {
      expect(jaccard(empty, A)).toBe(0);
    });

    it("J(A,∅) = 0", () => {
      expect(jaccard(A, empty)).toBe(0);
    });

    it("J(∅,∅) = 0 (by convention, since 0/0 is undefined)", () => {
      expect(jaccard(empty, empty)).toBe(0);
    });
  });

  describe("Bounds: 0 ≤ J(A,B) ≤ 1", () => {
    const pairs: [Set<number>, Set<number>][] = [
      [A, B],
      [A, C],
      [B, C],
      [A, D],
      [A, empty],
      [empty, empty],
      [A, A],
    ];

    it.each(pairs.map((p, i) => [i, ...p]))(
      "pair %i is bounded",
      (_, x, y) => {
        const j = jaccard(x as Set<number>, y as Set<number>);
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThanOrEqual(1);
      },
    );
  });

  describe("Disjoint sets: J(A,B) = 0 when A ∩ B = ∅", () => {
    it("completely disjoint sets have zero similarity", () => {
      const x = new Set([1, 2]);
      const y = new Set([3, 4]);
      expect(jaccard(x, y)).toBe(0);
    });
  });

  describe("Monotonicity: more shared elements → higher similarity", () => {
    it("adding a shared element increases similarity", () => {
      const small = new Set([1, 2]); // overlap with A: {1, 2}
      const large = new Set([1, 2, 3]); // overlap with A: {1, 2, 3}

      expect(jaccard(A, large)).toBeGreaterThan(jaccard(A, small));
    });
  });

  describe("Subset property: A ⊆ B → J(A,B) = |A|/|B|", () => {
    it("subset similarity equals ratio of cardinalities", () => {
      const subset = new Set([1, 2]);
      const superset = new Set([1, 2, 3, 4, 5]);
      expect(jaccard(subset, superset)).toBeCloseTo(
        subset.size / superset.size,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  METRIC SPACE AXIOMS on d(A,B) = 1 - J(A,B)
// ═══════════════════════════════════════════════════════════

describe("Jaccard Distance — Metric Axioms", () => {
  /**
   * d(A,B) = 1 - J(A,B) is known to satisfy the metric axioms for finite sets.
   * (Lipkus, 1999; Levandowsky & Winter, 1971)
   */
  const d = jaccardDistance;

  describe("M1: d(A,A) = 0 (identity of indiscernibles)", () => {
    it("distance from a set to itself is zero", () => {
      expect(d(A, A)).toBe(0);
      expect(d(B, B)).toBe(0);
    });
  });

  describe("M2: d(A,B) ≥ 0 (non-negativity)", () => {
    it("distance is never negative", () => {
      expect(d(A, B)).toBeGreaterThanOrEqual(0);
      expect(d(A, C)).toBeGreaterThanOrEqual(0);
      expect(d(empty, A)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("M3: d(A,B) = d(B,A) (symmetry)", () => {
    it("distance is symmetric", () => {
      expect(d(A, B)).toBe(d(B, A));
      expect(d(A, C)).toBe(d(C, A));
      expect(d(B, C)).toBe(d(C, B));
    });
  });

  describe("M4: d(A,C) ≤ d(A,B) + d(B,C) (triangle inequality)", () => {
    it("holds for A, B, C", () => {
      expect(d(A, C)).toBeLessThanOrEqual(d(A, B) + d(B, C) + 1e-10);
    });

    it("holds for all permutations of {A, B, C}", () => {
      const sets = [A, B, C];
      for (const x of sets) {
        for (const y of sets) {
          for (const z of sets) {
            expect(d(x, z)).toBeLessThanOrEqual(d(x, y) + d(y, z) + 1e-10);
          }
        }
      }
    });

    it("holds with the universal set D in the triangle", () => {
      expect(d(A, C)).toBeLessThanOrEqual(d(A, D) + d(D, C) + 1e-10);
    });
  });

  describe("Separation: d(A,B) = 0 ⟹ A = B (for non-empty sets)", () => {
    it("zero distance implies equal sets", () => {
      const X = new Set([1, 2, 3]);
      const Y = new Set([1, 2, 3]);
      expect(d(X, Y)).toBe(0);

      // And distinct sets have positive distance
      expect(d(A, B)).toBeGreaterThan(0);
    });
  });
});
