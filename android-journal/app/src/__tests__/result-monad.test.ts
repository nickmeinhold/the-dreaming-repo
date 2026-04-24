/**
 * Result<T, E> — Monad Laws and Functor Laws
 *
 * CATEGORY THEORY:
 *   Result is the Either monad in the Kleisli category:
 *   - Objects: types T
 *   - Arrows: functions T → Result<U, E>
 *   - Identity: ok
 *   - Composition: flatMap
 *
 *   Monad laws:
 *     Left identity:  ok(a).flatMap(f)          ≡ f(a)
 *     Right identity: m.flatMap(ok)             ≡ m
 *     Associativity:  m.flatMap(f).flatMap(g)   ≡ m.flatMap(x => f(x).flatMap(g))
 *
 *   Functor laws (derived):
 *     Identity:    m.map(id) ≡ m
 *     Composition: m.map(f).map(g) ≡ m.map(x => g(f(x)))
 */

import { describe, it, expect } from "vitest";
import { ok, err, fromNullable, fromPredicate, Ok, Err } from "@/lib/result";

// ── Test arrows (Kleisli arrows for Result) ─────────────

const double = (n: number) => ok(n * 2);
const addTen = (n: number) => ok(n + 10);
const safeSqrt = (n: number) =>
  n >= 0 ? ok(Math.sqrt(n)) : err("negative");
const id = <T>(x: T) => x;

// ═════���══════════════════════════════════════��══════════════
//  MONAD LAWS
// ══════════════���════════════════════════════════════════════

describe("Monad Laws", () => {
  it("left identity: ok(a).flatMap(f) ≡ f(a)", () => {
    const a = 5;
    const lhs = ok(a).flatMap(double);
    const rhs = double(a);

    expect(lhs.tag).toBe(rhs.tag);
    expect((lhs as Ok<number>).value).toBe((rhs as Ok<number>).value);
  });

  it("right identity: m.flatMap(ok) ≡ m", () => {
    const m = ok(42);
    const result = m.flatMap(ok);

    expect(result.tag).toBe("ok");
    expect((result as Ok<number>).value).toBe(42);
  });

  it("associativity: m.flatMap(f).flatMap(g) ≡ m.flatMap(x => f(x).flatMap(g))", () => {
    const m = ok(4);
    const lhs = m.flatMap(double).flatMap(addTen);
    const rhs = m.flatMap((x) => double(x).flatMap(addTen));

    expect((lhs as Ok<number>).value).toBe((rhs as Ok<number>).value);
  });
});

// ════��═════════════════════════════════════��════════════════
//  FUNCTOR LAWS
// ══════���═════════════════════��══════════════════════════════

describe("Functor Laws", () => {
  it("identity: m.map(id) ≡ m", () => {
    const m = ok(42);
    const result = m.map(id);

    expect(result.tag).toBe("ok");
    expect((result as Ok<number>).value).toBe(42);
  });

  it("composition: m.map(f).map(g) ≡ m.map(x => g(f(x)))", () => {
    const f = (n: number) => n * 2;
    const g = (n: number) => n + 10;
    const m = ok(5);

    const lhs = m.map(f).map(g);
    const rhs = m.map((x) => g(f(x)));

    expect((lhs as Ok<number>).value).toBe((rhs as Ok<number>).value);
  });

  it("map via flatMap: m.map(f) ≡ m.flatMap(x => ok(f(x)))", () => {
    const f = (n: number) => n * 3;
    const m = ok(7);

    const viaMap = m.map(f);
    const viaFlatMap = m.flatMap((x) => ok(f(x)));

    expect((viaMap as Ok<number>).value).toBe(
      (viaFlatMap as Ok<number>).value,
    );
  });
});

// ═══════════════════════════��═══════════════════════════════
//  CONSTRUCTION
// ══════════════════════════════���═════════════════════════��══

describe("Construction", () => {
  it("ok(42) has tag 'ok' and value 42", () => {
    const r = ok(42);
    expect(r.tag).toBe("ok");
    expect(r.value).toBe(42);
  });

  it("err('boom') has tag 'err' and error 'boom'", () => {
    const r = err("boom");
    expect(r.tag).toBe("err");
    expect(r.error).toBe("boom");
  });

  it("isOk() and isErr() predicates are correct", () => {
    expect(ok(1).isOk()).toBe(true);
    expect(ok(1).isErr()).toBe(false);
    expect(err("x").isOk()).toBe(false);
    expect(err("x").isErr()).toBe(true);
  });
});

// ═════���═════��════════════════════════════════���══════════════
//  FOLD
// ═══════════════════════════════════════════════════════════

describe("Fold", () => {
  it("ok(x).fold(f, g) calls f(x)", () => {
    const result = ok(10).fold(
      (n) => `got ${n}`,
      (e) => `err: ${e}`,
    );
    expect(result).toBe("got 10");
  });

  it("err(e).fold(f, g) calls g(e)", () => {
    const result = err("oops").fold(
      (n) => `got ${n}`,
      (e) => `err: ${e}`,
    );
    expect(result).toBe("err: oops");
  });
});

// ═���════════════���═════════════════════════════════��══════════
//  SHORT-CIRCUIT
// ═══��═══════════════════════════��════════════════════════���══

describe("Short-circuit (left absorption)", () => {
  it("err(e).flatMap(f) — f never called", () => {
    let called = false;
    const f = (_: never) => {
      called = true;
      return ok(0);
    };
    err("stop").flatMap(f);
    expect(called).toBe(false);
  });

  it("err(e).map(f) ��� f never called", () => {
    let called = false;
    const f = (_: never) => {
      called = true;
      return 0;
    };
    err("stop").map(f);
    expect(called).toBe(false);
  });
});

// ��═══════════════════���══════════════════════════════════════
//  ERROR MAPPING
// ═════════════════════════���═════════════════════════���═══════

describe("Error Mapping", () => {
  it("ok(x).mapErr(f) — f not called, ok preserved", () => {
    let called = false;
    const result = ok(42).mapErr(() => {
      called = true;
      return "new";
    });
    expect(called).toBe(false);
    expect(result.tag).toBe("ok");
    expect((result as Ok<number>).value).toBe(42);
  });

  it("err(e).mapErr(f) — transforms error", () => {
    const result = err("lower").mapErr((e) => e.toUpperCase());
    expect(result.tag).toBe("err");
    expect((result as Err<string>).error).toBe("LOWER");
  });
});

// ═══���════════════════════���══════════════════════════════════
//  COMBINATORS
// ════���══════════════════════���═══════════════════════���═══════

describe("Combinators", () => {
  it("fromNullable(null) returns err", () => {
    const r = fromNullable(null, "missing");
    expect(r.tag).toBe("err");
    expect((r as Err<string>).error).toBe("missing");
  });

  it("fromNullable(42) returns ok", () => {
    const r = fromNullable(42, "missing");
    expect(r.tag).toBe("ok");
    expect((r as Ok<number>).value).toBe(42);
  });

  it("fromPredicate: passing predicate returns ok, failing returns err", () => {
    const pass = fromPredicate(5, (x) => x > 3, "too small");
    const fail = fromPredicate(1, (x) => x > 3, "too small");

    expect(pass.tag).toBe("ok");
    expect((pass as Ok<number>).value).toBe(5);
    expect(fail.tag).toBe("err");
    expect((fail as Err<string>).error).toBe("too small");
  });
});
