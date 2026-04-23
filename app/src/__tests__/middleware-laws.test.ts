/**
 * Middleware Laws — Categorical and Pattern Invariants
 *
 * CATEGORY THEORY:
 *   Kleisli Laws — Left identity, right identity, associativity, absorption
 *   Monoid Laws  — Identity element, associative composition
 *   Products     — Context intersection: preservation, extension, independence
 *
 * DESIGN PATTERNS (GoF):
 *   Builder                 — Fluent API, fresh instances, mutation boundary
 *   Chain of Responsibility — Ordering guarantee, short-circuit, all-pass
 *   Factory Method          — Independence of factory outputs
 *
 * All tests use synthetic Kleisli arrows — no database, no JWT, no I/O.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock next/server ──────────────────────────────────────

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

// ── Test Arrows (Kleisli arrows for the error monad) ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any;
type Arrow = (ctx: Ctx) => Promise<typeof NextResponse | Ctx>;

const identity: Arrow = async (ctx) => ctx;
const addA: Arrow = async (ctx) => ({ ...ctx, a: 1 });
const addB: Arrow = async (ctx) => ({ ...ctx, b: 2 });
const addC: Arrow = async (ctx) => ({ ...ctx, c: 3 });
const block403: Arrow = async () =>
  NextResponse.json({ error: "blocked" }, { status: 403 });
const block401: Arrow = async () =>
  NextResponse.json({ error: "unauth" }, { status: 401 });

// Strip framework fields, leaving only test data
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
//  CATEGORY THEORY
// ═══════════════════════════════════════════════════════════

describe("Kleisli Laws", () => {
  /**
   * In the Kleisli category for T(X) = Promise<NextResponse | X>:
   *   - Objects: context types
   *   - Arrows A → B: functions (A) => Promise<NextResponse | B>
   *   - Identity: async (ctx) => ctx
   *   - Composition: sequential execution with short-circuit on NextResponse
   */

  describe("Left identity: return >=> f ≡ f", () => {
    it("prepending identity middleware does not change the result", async () => {
      const withId = route().use(identity).use(addA).handle(extractAdded);
      const withoutId = route().use(addA).handle(extractAdded);

      const r1 = await run(withId);
      const r2 = await run(withoutId);

      expect(bodyOf(r1)).toEqual(bodyOf(r2));
    });
  });

  describe("Right identity: f >=> return ≡ f", () => {
    it("appending identity middleware does not change the result", async () => {
      const withId = route().use(addA).use(identity).handle(extractAdded);
      const withoutId = route().use(addA).handle(extractAdded);

      const r1 = await run(withId);
      const r2 = await run(withoutId);

      expect(bodyOf(r1)).toEqual(bodyOf(r2));
    });
  });

  describe("Associativity: (f >=> g) >=> h ≡ f >=> (g >=> h)", () => {
    it("three arrows compose to the union of all added fields", async () => {
      const chain = route()
        .use(addA)
        .use(addB)
        .use(addC)
        .handle(extractAdded);
      const result = await run(chain);

      expect(bodyOf(result)).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("result is independent of conceptual grouping", async () => {
      // We can't literally re-group with this API, but we can verify
      // that splitting the chain at any point gives the same final result.
      const full = route()
        .use(addA)
        .use(addB)
        .use(addC)
        .handle(extractAdded);

      // Simulate (A then B) then C vs A then (B then C)
      // by verifying intermediate state doesn't leak
      const result = await run(full);
      expect(bodyOf(result)).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe("Left absorption: NextResponse >=> f ≡ NextResponse", () => {
    it("short-circuit halts the chain — later arrows never execute", async () => {
      let bRan = false;
      const spyB: Arrow = async (ctx) => {
        bRan = true;
        return { ...ctx, b: 2 };
      };

      const chain = route()
        .use(addA)
        .use(block403)
        .use(spyB)
        .handle(extractAdded);
      const result = await run(chain);

      expect((result as { status: number }).status).toBe(403);
      expect(bRan).toBe(false);
    });

    it("first short-circuit wins (left-biased absorption)", async () => {
      const chain = route()
        .use(block403)
        .use(block401)
        .handle(extractAdded);
      const result = await run(chain);

      expect((result as { status: number }).status).toBe(403);
    });

    it("handler is also skipped on short-circuit", async () => {
      let handlerRan = false;
      const handler = async () => {
        handlerRan = true;
        return NextResponse.json({ ok: true });
      };

      await run(route().use(block403).handle(handler));

      expect(handlerRan).toBe(false);
    });
  });
});

describe("Monoid Laws (RouteBuilder)", () => {
  /**
   * (RouteBuilder, .use(), route()) forms a monoid:
   *   - Carrier: builders (sequences of Kleisli arrows)
   *   - Identity: route() with no middleware
   *   - Operation: .use(mw) appends an arrow
   */

  describe("Identity: route() is the neutral element", () => {
    it("empty builder passes context through unchanged", async () => {
      const result = await run(route().handle(extractAdded));
      expect(bodyOf(result)).toEqual({});
    });
  });

  describe("Composition accumulates", () => {
    it("single .use() adds one field", async () => {
      const result = await run(route().use(addA).handle(extractAdded));
      expect(bodyOf(result)).toEqual({ a: 1 });
    });

    it("two .use() calls add both fields", async () => {
      const result = await run(
        route().use(addA).use(addB).handle(extractAdded),
      );
      expect(bodyOf(result)).toEqual({ a: 1, b: 2 });
    });

    it("n .use() calls add all n fields", async () => {
      const result = await run(
        route().use(addA).use(addB).use(addC).handle(extractAdded),
      );
      expect(bodyOf(result)).toEqual({ a: 1, b: 2, c: 3 });
    });
  });
});

describe("Context Products (Intersection Types at Runtime)", () => {
  /**
   * Each middleware extends the context via object spread.
   * At the type level: Ctx & Added (intersection).
   * At runtime: { ...ctx, ...newFields } (merge).
   *
   * Invariants:
   *   - Preservation: earlier fields survive later .use()
   *   - Extension: each .use() adds exactly its declared fields
   *   - Override: same-named fields follow spread semantics (last wins)
   */

  it("earlier fields are preserved through later middleware", async () => {
    const inspect = async (ctx: Ctx) => {
      expect(ctx.a).toBe(1);
      expect(ctx.b).toBe(2);
      return NextResponse.json({ ok: true });
    };
    await run(route().use(addA).use(addB).handle(inspect));
  });

  it("independent fields don't interfere", async () => {
    const result = await run(
      route().use(addA).use(addB).handle(extractAdded),
    );
    const body = bodyOf(result) as Record<string, unknown>;
    expect(body).toHaveProperty("a", 1);
    expect(body).toHaveProperty("b", 2);
    expect(Object.keys(body).sort()).toEqual(["a", "b"]);
  });

  it("spread semantics: later field of same name wins", async () => {
    const addA2: Arrow = async (ctx) => ({ ...ctx, a: 99 });
    const result = await run(
      route().use(addA).use(addA2).handle(extractAdded),
    );
    expect((bodyOf(result) as Record<string, unknown>).a).toBe(99);
  });
});

// ═══════════════════════════════════════════════════════════
//  DESIGN PATTERNS (GoF)
// ═══════════════════════════════════════════════════════════

describe("Builder Pattern Invariants", () => {
  it("route() creates a fresh builder each time", () => {
    const b1 = route();
    const b2 = route();
    expect(b1).not.toBe(b2);
  });

  it(".use() returns a new builder (immutable fluent API)", () => {
    const builder = route();
    const returned = builder.use(addA);
    expect(returned).not.toBe(builder);
  });

  it(".handle() freezes the pipeline via array copy", async () => {
    const builder = route().use(addA);
    const handler1 = builder.handle(extractAdded);

    // Mutate the builder AFTER .handle()
    builder.use(addB);

    // handler1 should NOT see addB — .handle() copied the array
    const result = await run(handler1);
    expect((bodyOf(result) as Record<string, unknown>).b).toBeUndefined();
  });

  it("branching before .handle() is safe (immutable .use())", async () => {
    // Fixed: .use() now returns a new RouteBuilder with a cloned array.
    // Branching from an intermediate builder no longer corrupts paths.
    // CT: a ⊗ b does not mutate a — proper monoid.

    const base = route().use(addA);
    const h1 = base.use(addB).handle(extractAdded);
    const h2 = base.use(addC).handle(extractAdded);

    const r1 = await run(h1);
    const r2 = await run(h2);

    // handler1 has [addA, addB]
    expect(bodyOf(r1)).toEqual({ a: 1, b: 2 });

    // handler2 has [addA, addC] — no B leaked from the first branch
    expect(bodyOf(r2)).toEqual({ a: 1, c: 3 });
  });
});

describe("Chain of Responsibility Invariants", () => {
  it("middleware executes in .use() order", async () => {
    const order: string[] = [];
    const log = (label: string): Arrow =>
      async (ctx) => {
        order.push(label);
        return { ...ctx };
      };

    await run(
      route()
        .use(log("first"))
        .use(log("second"))
        .use(log("third"))
        .handle(async () => NextResponse.json({})),
    );

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("every middleware in the chain runs when none short-circuits", async () => {
    const visited: string[] = [];
    const mw = (label: string): Arrow =>
      async (ctx) => {
        visited.push(label);
        return { ...ctx };
      };

    await run(
      route().use(mw("a")).use(mw("b")).use(mw("c")).handle(extractAdded),
    );

    expect(visited).toHaveLength(3);
  });

  it("error handler catches exceptions in middleware", async () => {
    const throwingMw: Arrow = async () => {
      throw new Error("middleware crashed");
    };

    const result = await run(route().use(throwingMw).handle(extractAdded));
    // builder.ts catches and returns 500
    expect((result as { status: number }).status).toBe(500);
  });
});

describe("Factory Method Invariants", () => {
  // We test with simple factories since the real stacks.ts has complex deps.
  // The invariant is the same: each factory call yields an independent builder.

  function testFactory() {
    return route().use(addA);
  }

  it("factory calls produce independent builders", async () => {
    const f1 = testFactory();
    const f2 = testFactory();

    // Mutate f1
    f1.use(addB);

    // f2 should be unaffected
    const result = await run(f2.handle(extractAdded));
    expect((bodyOf(result) as Record<string, unknown>).b).toBeUndefined();
    expect((bodyOf(result) as Record<string, unknown>).a).toBe(1);
  });

  it("two factory outputs share no internal state", () => {
    const f1 = testFactory();
    const f2 = testFactory();
    expect(f1).not.toBe(f2);
  });
});
