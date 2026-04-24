/**
 * Paper Workflow — Finite Automaton Laws + State Pattern Invariants
 *
 * CATEGORY THEORY:
 *   The workflow is a finite automaton viewed as a thin category:
 *   - Objects: states (submitted, under-review, revision, accepted, published)
 *   - Morphisms: valid transitions (at most one between any pair)
 *   Tests: determinism, reachability, no dead states, terminal state, irreflexivity
 *
 * DESIGN PATTERNS (GoF):
 *   State Pattern — state determines available behaviour.
 *   Tests: each state has a well-defined transition set, invalid transitions rejected
 */

import { describe, it, expect } from "vitest";
import { canTransition, validNextStatuses } from "@/lib/paper-workflow";

const ALL_STATES = [
  "submitted",
  "under-review",
  "revision",
  "accepted",
  "published",
];

// ═══════════════════════════════════════════════════════════
//  CATEGORY THEORY: Finite Automaton Laws
// ═══════════════════════════════════════════════════════════

describe("Finite Automaton Laws", () => {
  describe("Determinism: same input always gives same output", () => {
    it("canTransition is a pure function", () => {
      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          const r1 = canTransition(from, to);
          const r2 = canTransition(from, to);
          expect(r1).toBe(r2);
        }
      }
    });

    it("validNextStatuses is a pure function", () => {
      for (const state of ALL_STATES) {
        const r1 = validNextStatuses(state);
        const r2 = validNextStatuses(state);
        expect(r1).toEqual(r2);
      }
    });
  });

  describe("No dead states: every non-terminal state has ≥1 outgoing transition", () => {
    const nonTerminal = ALL_STATES.filter((s) => s !== "published");

    it.each(nonTerminal)("%s has at least one valid transition", (state) => {
      expect(validNextStatuses(state).length).toBeGreaterThan(0);
    });
  });

  describe("Terminal state: 'published' is absorbing", () => {
    it("published has no outgoing transitions", () => {
      expect(validNextStatuses("published")).toEqual([]);
    });

    it("no state can transition to submitted (initial state is source-only)", () => {
      for (const state of ALL_STATES) {
        expect(canTransition(state, "submitted")).toBe(false);
      }
    });
  });

  describe("Reachability: every state is reachable from 'submitted'", () => {
    it("BFS from submitted covers all states", () => {
      const reachable = new Set<string>();
      const queue = ["submitted"];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        for (const next of validNextStatuses(current)) {
          queue.push(next);
        }
      }

      for (const state of ALL_STATES) {
        expect(reachable.has(state)).toBe(true);
      }
    });
  });

  describe("Irreflexivity: no self-loops", () => {
    it.each(ALL_STATES)("%s cannot transition to itself", (state) => {
      expect(canTransition(state, state)).toBe(false);
    });
  });

  describe("Cycle structure: revision ↔ under-review is the only cycle", () => {
    it("under-review → revision is valid", () => {
      expect(canTransition("under-review", "revision")).toBe(true);
    });

    it("revision → under-review is valid", () => {
      expect(canTransition("revision", "under-review")).toBe(true);
    });

    it("no other back-edges exist", () => {
      // The only reverse edge is revision → under-review.
      // Check that no other state goes "backward" in the natural ordering.
      const forwardOrder: Record<string, number> = {
        submitted: 0,
        "under-review": 1,
        revision: 1, // same level as under-review (they cycle)
        accepted: 2,
        published: 3,
      };

      for (const from of ALL_STATES) {
        for (const to of validNextStatuses(from)) {
          if (from === "revision" && to === "under-review") continue; // known cycle
          expect(forwardOrder[to]).toBeGreaterThanOrEqual(forwardOrder[from]);
        }
      }
    });
  });

  describe("Invalid state handling (robustness)", () => {
    it("unknown source state → canTransition returns false", () => {
      expect(canTransition("nonexistent", "submitted")).toBe(false);
    });

    it("unknown target state → canTransition returns false", () => {
      expect(canTransition("submitted", "nonexistent")).toBe(false);
    });

    it("unknown state → validNextStatuses returns empty array", () => {
      expect(validNextStatuses("nonexistent")).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  DESIGN PATTERNS: State Pattern Invariants
// ═══════════════════════════════════════════════════════════

describe("State Pattern Invariants", () => {
  describe("State determines behaviour: each state has a unique transition set", () => {
    it("transition table matches the documented workflow", () => {
      expect(validNextStatuses("submitted")).toEqual(["under-review"]);
      expect(validNextStatuses("under-review").sort()).toEqual([
        "accepted",
        "revision",
      ]);
      expect(validNextStatuses("revision")).toEqual(["under-review"]);
      expect(validNextStatuses("accepted")).toEqual(["published"]);
      expect(validNextStatuses("published")).toEqual([]);
    });
  });

  describe("Invalid transitions are rejected", () => {
    const invalidPairs = [
      ["submitted", "accepted"],
      ["submitted", "published"],
      ["submitted", "revision"],
      ["under-review", "submitted"],
      ["under-review", "published"],
      ["accepted", "revision"],
      ["accepted", "submitted"],
      ["published", "submitted"],
      ["published", "under-review"],
    ];

    it.each(invalidPairs)(
      "%s → %s is rejected",
      (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      },
    );
  });

  describe("Consistency: canTransition agrees with validNextStatuses", () => {
    it("for every state pair, both functions agree", () => {
      for (const from of ALL_STATES) {
        const validTargets = validNextStatuses(from);
        for (const to of ALL_STATES) {
          expect(canTransition(from, to)).toBe(validTargets.includes(to));
        }
      }
    });
  });
});
