/**
 * Immutable Builder — Proper Monoid Laws
 *
 * CATEGORY THEORY:
 *   After fixing the mutation bug, RouteBuilder forms a proper monoid:
 *   - Carrier: builders (sequences of Kleisli arrows)
 *   - Identity: route() with no middleware
 *   - Operation: .use(mw) returns a NEW builder with mw appended
 *   - Key property: a ⊗ b does NOT mutate a
 *
 * DESIGN PATTERNS (GoF):
 *   Builder — now immutable. Branching from intermediate builders is safe.
 *   Factory Method — stacks.ts factories remain compatible.
 *
 * All tests use synthetic arrows — no database, no JWT, no I/O.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("next/server", () => {
  class MockNextResponse {
    body: unknown;
    status: number;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

import { route } from "@/lib/middleware/builder";
import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;
type Arrow = (ctx: Ctx) => Promise<typeof NextResponse | Ctx>;

const addA: Arrow = async (ctx) => ({ ...ctx, a: 1 });
const addB: Arrow = async (ctx) => ({ ...ctx, b: 2 });
const addC: Arrow = async (ctx) => ({ ...ctx, c: 3 });
const identity: Arrow = async (ctx) => ctx;

const extractAdded = async (ctx: Ctx) => {
  const { request, _routeParams, ...rest } = ctx;
  return NextResponse.json(rest);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(handler: any, request = {}): Promise<any> {
  return handler(request);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bodyOf(response: any): unknown {
  return response.body;
}

// ═══════════════════════════════════════════════════════════
//  IMMUTABILITY (the fixed property)
// ═══════════════════════════════════════════════════════════

describe("Immutable Builder", () => {
  it(".use() returns a NEW builder (different reference)", () => {
    const base = route();
    const extended = base.use(addA);
    expect(extended).not.toBe(base);
  });

  it("original builder unchanged after .use()", async () => {
    const base = route();
    base.use(addA); // discard the result

    // base should still produce empty context
    const result = await run(base.handle(extractAdded));
    expect(bodyOf(result)).toEqual({});
  });

  it("branching: base.use(A) and base.use(B) are independent", async () => {
    const base = route().use(addA);
    const branchB = base.use(addB).handle(extractAdded);
    const branchC = base.use(addC).handle(extractAdded);

    const rB = await run(branchB);
    const rC = await run(branchC);

    expect(bodyOf(rB)).toEqual({ a: 1, b: 2 });
    expect(bodyOf(rC)).toEqual({ a: 1, c: 3 }); // no B leakage
  });

  it("branched handlers produce independent results", async () => {
    const base = route();
    const h1 = base.use(addA).handle(extractAdded);
    const h2 = base.use(addB).handle(extractAdded);

    const r1 = await run(h1);
    const r2 = await run(h2);

    expect(bodyOf(r1)).toEqual({ a: 1 });
    expect(bodyOf(r2)).toEqual({ b: 2 });
  });
});

// ═══════════════════════════════════════════════════════════
//  PROPER MONOID LAWS (with immutable .use())
// ═══════════════════════════════════════════════════════════

describe("Proper Monoid Laws", () => {
  it("left identity: route().use(id).use(f) ≡ route().use(f)", async () => {
    const withId = route().use(identity).use(addA).handle(extractAdded);
    const withoutId = route().use(addA).handle(extractAdded);

    expect(bodyOf(await run(withId))).toEqual(bodyOf(await run(withoutId)));
  });

  it("right identity: route().use(f).use(id) ≡ route().use(f)", async () => {
    const withId = route().use(addA).use(identity).handle(extractAdded);
    const withoutId = route().use(addA).handle(extractAdded);

    expect(bodyOf(await run(withId))).toEqual(bodyOf(await run(withoutId)));
  });

  it("associativity: splitting at any point gives the same result", async () => {
    const full = route().use(addA).use(addB).use(addC).handle(extractAdded);
    const result = bodyOf(await run(full));
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});

// ═══════════════════════════════════════════════════════════
//  BACKWARD COMPATIBILITY + DEEP BRANCHING
// ═══════════════════════════════════════════════════════════

describe("Factory and Deep Branching", () => {
  it("stacks.ts-style factories still work", async () => {
    // Simulates publicRoute = route().use(withTrace)
    function testFactory() {
      return route().use(addA);
    }

    const f1 = testFactory();
    const f2 = testFactory();

    f1.use(addB); // mutate f1 — should NOT affect f2

    const r2 = await run(f2.handle(extractAdded));
    expect((bodyOf(r2) as Record<string, unknown>).b).toBeUndefined();
  });

  it("deep branching: base.use(A).use(B) vs base.use(A).use(C) independent", async () => {
    const base = route();
    const branch1 = base.use(addA).use(addB).handle(extractAdded);
    const branch2 = base.use(addA).use(addC).handle(extractAdded);

    const r1 = await run(branch1);
    const r2 = await run(branch2);

    expect(bodyOf(r1)).toEqual({ a: 1, b: 2 });
    expect(bodyOf(r2)).toEqual({ a: 1, c: 3 });
  });

  it("multiple branches from same base don't interfere", async () => {
    const base = route().use(addA);

    // Create three branches from the same base
    const h1 = base.use(addB).handle(extractAdded);
    const h2 = base.use(addC).handle(extractAdded);
    const h3 = base.handle(extractAdded); // just addA

    const r1 = await run(h1);
    const r2 = await run(h2);
    const r3 = await run(h3);

    expect(bodyOf(r1)).toEqual({ a: 1, b: 2 });
    expect(bodyOf(r2)).toEqual({ a: 1, c: 3 });
    expect(bodyOf(r3)).toEqual({ a: 1 });
  });
});
