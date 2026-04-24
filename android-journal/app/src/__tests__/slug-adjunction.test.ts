/**
 * Slug ↔ Label — Adjunction Round-Trip Properties
 *
 * CATEGORY THEORY:
 *   labelToSlug and slugToLabel form a free/forgetful adjunction:
 *     - labelToSlug: "free" — forgets casing, normalises whitespace to hyphens
 *     - slugToLabel: "forgetful" — recovers a Title Case human-readable form
 *
 *   The adjunction triangle identities become idempotency conditions:
 *     - Unit η = slugToLabel ∘ labelToSlug: normalising twice gives same result
 *     - Counit ε = labelToSlug ∘ slugToLabel: round-tripping a slug is identity
 *
 *   These functions are from actions/papers.ts (not exported), so we
 *   reimplement the exact logic and test the mathematical invariants.
 */

import { describe, it, expect } from "vitest";
import { slugToLabel } from "@/lib/tags";

// labelToSlug mirrors the tag processing in submitPaper (not separately exported
// since it's inline in the FormData parsing). The logic is: trim → lowercase → hyphenate.
function labelToSlug(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

// ═══════════════════════════════════════════════════════════
//  ADJUNCTION PROPERTIES
// ═══════════════════════════════════════════════════════════

describe("Slug ↔ Label Adjunction", () => {
  describe("Unit η = slugToLabel ∘ labelToSlug is idempotent", () => {
    it("η(η(x)) = η(x) — double-normalising is stable", () => {
      const labels = [
        "category theory",
        "Genetic Algorithms",
        "  machine   learning  ",
        "a",
        "UPPER CASE WORDS",
      ];

      for (const label of labels) {
        const once = slugToLabel(labelToSlug(label));
        const twice = slugToLabel(labelToSlug(once));
        expect(twice).toBe(once);
      }
    });
  });

  describe("Counit ε = labelToSlug ∘ slugToLabel is the identity on normalised slugs", () => {
    it("ε(slug) = slug for well-formed slugs", () => {
      const slugs = [
        "category-theory",
        "genetic-algorithms",
        "machine-learning",
        "a",
        "one-two-three-four",
      ];

      for (const slug of slugs) {
        expect(labelToSlug(slugToLabel(slug))).toBe(slug);
      }
    });
  });

  describe("Counit idempotence: ε(ε(slug)) = ε(slug)", () => {
    it("double round-trip is same as single round-trip", () => {
      const slugs = ["category-theory", "a", "long-multi-word-tag"];

      for (const slug of slugs) {
        const once = labelToSlug(slugToLabel(slug));
        const twice = labelToSlug(slugToLabel(once));
        expect(twice).toBe(once);
      }
    });
  });

  describe("Retraction: labelToSlug is a left inverse of slugToLabel on normalised slugs", () => {
    it("slug → label → slug is identity", () => {
      const slugs = ["type-theory", "abstract-algebra", "x"];

      for (const slug of slugs) {
        expect(labelToSlug(slugToLabel(slug))).toBe(slug);
      }
    });

    it("label → slug → label is NOT identity (information loss)", () => {
      // labelToSlug loses casing, so the round-trip produces Title Case
      const label = "UPPER case MiXeD";
      const roundTripped = slugToLabel(labelToSlug(label));
      expect(roundTripped).not.toBe(label);
      expect(roundTripped).toBe("Upper Case Mixed");
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  STRUCTURAL PRESERVATION
// ═══════════════════════════════════════════════════════════

describe("Structural Preservation", () => {
  describe("Word count is preserved through round-trip", () => {
    it("slug segments = label words after round-trip", () => {
      const slug = "one-two-three";
      const label = slugToLabel(slug);
      const back = labelToSlug(label);

      expect(slug.split("-").length).toBe(label.split(" ").length);
      expect(back.split("-").length).toBe(slug.split("-").length);
    });
  });

  describe("Fixed points", () => {
    it("single lowercase word is a fixed point of labelToSlug", () => {
      expect(labelToSlug("topology")).toBe("topology");
    });

    it("single Title Case word is a fixed point of slugToLabel", () => {
      expect(slugToLabel("topology")).toBe("Topology");
      // Note: capitalisation means it's NOT a fixed point of the full round-trip
    });

    it("single lowercase word: slug → label → slug is identity", () => {
      const word = "topology";
      expect(labelToSlug(slugToLabel(word))).toBe(word);
    });
  });

  describe("Empty and edge cases", () => {
    it("empty string", () => {
      expect(labelToSlug("")).toBe("");
      expect(slugToLabel("")).toBe("");
    });

    it("whitespace-only input collapses to empty", () => {
      expect(labelToSlug("   ")).toBe("");
    });
  });
});
