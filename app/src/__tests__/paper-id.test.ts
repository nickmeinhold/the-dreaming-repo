/**
 * Paper ID Generation — Monotonicity and Format Invariants
 *
 * CATEGORY THEORY:
 *   Paper IDs form a totally ordered monoid under string comparison:
 *   - The zero-padding ensures lexicographic = numeric order
 *   - Each call to nextPaperId produces the successor in the order
 *   - Monotonicity: id_n < id_{n+1} always
 *
 * DESIGN PATTERN:
 *   Factory Method — nextPaperId is a factory that produces
 *   the next valid ID given the current state (latest paper).
 *   The invariant: the factory is deterministic given its input.
 */

import { describe, it, expect } from "vitest";
import { nextPaperId } from "@/lib/paper-id";

// ── Mock Prisma client (duck-typed) ──────────────────────

function mockPrisma(latestPaperId: string | null) {
  return {
    paper: {
      findFirst: async () =>
        latestPaperId ? { paperId: latestPaperId } : null,
    },
  };
}

const year = new Date().getFullYear();

// ═══════════════════════════════════════════════════════════
//  FORMAT INVARIANTS
// ═══════════════════════════════════════════════════════════

describe("Paper ID Format: YYYY-NNN", () => {
  it("matches the pattern exactly", async () => {
    const id = await nextPaperId(mockPrisma(null));
    expect(id).toMatch(/^\d{4}-\d{3}$/);
  });

  it("starts with the current year", async () => {
    const id = await nextPaperId(mockPrisma(null));
    expect(id.startsWith(`${year}-`)).toBe(true);
  });

  it("zero-pads the sequence number to 3 digits", async () => {
    const id = await nextPaperId(mockPrisma(null));
    expect(id).toBe(`${year}-001`);
  });

  it("preserves padding at boundary values", async () => {
    expect(await nextPaperId(mockPrisma(`${year}-008`))).toBe(`${year}-009`);
    expect(await nextPaperId(mockPrisma(`${year}-009`))).toBe(`${year}-010`);
    expect(await nextPaperId(mockPrisma(`${year}-099`))).toBe(`${year}-100`);
  });
});

// ═══════════════════════════════════════════════════════════
//  MONOTONICITY (TOTAL ORDER)
// ═══════════════════════════════════════════════════════════

describe("Paper ID Monotonicity", () => {
  it("first paper in a year gets 001", async () => {
    expect(await nextPaperId(mockPrisma(null))).toBe(`${year}-001`);
  });

  it("each ID is the successor of the previous", async () => {
    const cases = [
      [null, `${year}-001`],
      [`${year}-001`, `${year}-002`],
      [`${year}-005`, `${year}-006`],
      [`${year}-099`, `${year}-100`],
      [`${year}-999`, `${year}-1000`], // exceeds 3-digit padding
    ] as const;

    for (const [latest, expected] of cases) {
      expect(await nextPaperId(mockPrisma(latest))).toBe(expected);
    }
  });

  it("strict ordering: id_n < id_{n+1} under string comparison", async () => {
    const ids: string[] = [];
    let latest: string | null = null;

    for (let i = 0; i < 10; i++) {
      const id = await nextPaperId(mockPrisma(latest));
      ids.push(id);
      latest = id;
    }

    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  FACTORY METHOD INVARIANTS
// ═══════════════════════════════════════════════════════════

describe("Factory Determinism", () => {
  it("same input always produces same output", async () => {
    const id1 = await nextPaperId(mockPrisma(`${year}-042`));
    const id2 = await nextPaperId(mockPrisma(`${year}-042`));
    expect(id1).toBe(id2);
  });

  it("null input always produces 001", async () => {
    const id1 = await nextPaperId(mockPrisma(null));
    const id2 = await nextPaperId(mockPrisma(null));
    expect(id1).toBe(id2);
    expect(id1).toBe(`${year}-001`);
  });
});
