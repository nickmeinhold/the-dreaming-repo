/**
 * Validation — Applicative Functor Laws + Primitive Validators
 *
 * CATEGORY THEORY:
 *   Validation is the free applicative functor over (string[], ++).
 *   Unlike the Either monad (Result), which short-circuits on first error,
 *   the Validation applicative accumulates ALL errors via the monoid.
 *
 *   Applicative laws:
 *     Identity:     pure(id) <*> v ≡ v
 *     Homomorphism: pure(f) <*> pure(x) ≡ pure(f(x))
 *     Composition:  pure(∘) <*> u <*> v <*> w ≡ u <*> (v <*> w)
 *     Interchange:  u <*> pure(y) ≡ pure(f => f(y)) <*> u
 */

import { describe, it, expect } from "vitest";
import {
  valid,
  invalid,
  invalidOne,
  pure,
  ap,
  combine,
  combineAll,
  mapValid,
  mapErrors,
  required,
  minLength,
  maxLength,
  pattern,
  oneOf,
  range,
  predicate,
  type Validation,
} from "@/lib/validation/combinators";

// ── Helpers ─────────────────────────────────────────────

const id = <T>(x: T): T => x;
const compose =
  <A, B, C>(f: (b: B) => C) =>
  (g: (a: A) => B) =>
  (a: A): C =>
    f(g(a));

// ═══════════════════════════════════════════════════════════
//  APPLICATIVE LAWS
// ═══════════════════════════════════════════════════════════

describe("Applicative Laws", () => {
  it("identity: pure(id) <*> v ≡ v", () => {
    const v = valid(42);
    const result = ap(pure(id<number>), v);

    expect(result).toEqual(v);
  });

  it("homomorphism: pure(f) <*> pure(x) ≡ pure(f(x))", () => {
    const f = (n: number) => n * 2;
    const x = 21;

    const lhs = ap(pure(f), pure(x));
    const rhs = pure(f(x));

    expect(lhs).toEqual(rhs);
  });

  it("composition: pure(∘) <*> u <*> v <*> w ≡ u <*> (v <*> w)", () => {
    const u: Validation<(n: number) => string> = valid((n) => `#${n}`);
    const v: Validation<(n: number) => number> = valid((n) => n * 2);
    const w: Validation<number> = valid(5);

    // LHS: pure(compose) <*> u <*> v <*> w
    const composeV = pure(compose<number, number, string>);
    const step1 = ap(composeV, u); // Validation<(g: number→number) => (a: number) => string>
    const step2 = ap(step1, v); // Validation<(a: number) => string>
    const lhs = ap(step2, w); // Validation<string>

    // RHS: u <*> (v <*> w)
    const innerApp = ap(v, w); // Validation<number>
    const rhs = ap(u, innerApp); // Validation<string>

    expect(lhs).toEqual(rhs);
    expect(lhs).toEqual(valid("#10"));
  });

  it("interchange: u <*> pure(y) ≡ pure(f => f(y)) <*> u", () => {
    const u: Validation<(n: number) => string> = valid((n) => `val:${n}`);
    const y = 7;

    const lhs = ap(u, pure(y));
    const rhs = ap(
      pure((f: (n: number) => string) => f(y)),
      u,
    );

    expect(lhs).toEqual(rhs);
  });
});

// ═══════════════════════════════════════════════════════════
//  ERROR ACCUMULATION (the key property)
// ═══════════════════════════════════════════════════════════

describe("Error Accumulation", () => {
  it("two invalids combine to collect ALL errors", () => {
    const a = invalidOne("err A");
    const b = invalidOne("err B");
    const result = combine(a, b);

    expect(result.tag).toBe("invalid");
    expect((result as { errors: string[] }).errors).toEqual([
      "err A",
      "err B",
    ]);
  });

  it("valid + valid = valid with pair", () => {
    const result = combine(valid(1), valid("x"));
    expect(result).toEqual(valid([1, "x"]));
  });

  it("valid + invalid = invalid (errors from invalid)", () => {
    const result = combine(valid(1), invalidOne("bad"));
    expect(result.tag).toBe("invalid");
    expect((result as { errors: string[] }).errors).toEqual(["bad"]);
  });

  it("invalid + valid = invalid (errors from invalid)", () => {
    const result = combine(invalidOne("bad"), valid(1));
    expect(result.tag).toBe("invalid");
    expect((result as { errors: string[] }).errors).toEqual(["bad"]);
  });
});

// ═══════════════════════════════════════════════════════════
//  PRIMITIVE VALIDATORS
// ═══════════════════════════════════════════════════════════

describe("Primitive Validators", () => {
  it("required: non-empty string → valid", () => {
    const result = required("title")("Hello");
    expect(result.tag).toBe("valid");
    expect((result as { value: string }).value).toBe("Hello");
  });

  it("required: empty/null → invalid", () => {
    expect(required("title")("").tag).toBe("invalid");
    expect(required("title")(null).tag).toBe("invalid");
    expect(required("title")(undefined).tag).toBe("invalid");
  });

  it("minLength(3): 'ab' → invalid, 'abc' → valid", () => {
    expect(minLength(3)("ab").tag).toBe("invalid");
    expect(minLength(3)("abc").tag).toBe("valid");
  });

  it("maxLength(5): enforces upper bound", () => {
    expect(maxLength(5)("hello").tag).toBe("valid");
    expect(maxLength(5)("toolong").tag).toBe("invalid");
  });

  it("pattern: matches → valid, no match → invalid", () => {
    const isSlug = pattern(/^[a-z0-9-]+$/, "Must be a valid slug");
    expect(isSlug("hello-world").tag).toBe("valid");
    expect(isSlug("Hello World").tag).toBe("invalid");
  });

  it("oneOf: 'research' → valid, 'invalid' → invalid", () => {
    const category = oneOf(["research", "expository"] as const);
    expect(category("research").tag).toBe("valid");
    expect(category("other").tag).toBe("invalid");
  });

  it("range(1,5): 3 → valid, 0 → invalid, 6 → invalid", () => {
    expect(range(1, 5)(3).tag).toBe("valid");
    expect(range(1, 5)(0).tag).toBe("invalid");
    expect(range(1, 5)(6).tag).toBe("invalid");
  });

  it("predicate: custom boolean check", () => {
    const isEven = predicate<number>((n) => n % 2 === 0, "Must be even");
    expect(isEven(4).tag).toBe("valid");
    expect(isEven(3).tag).toBe("invalid");
  });
});

// ═══════════════════════════════════════════════════════════
//  COMPOSITION
// ═══════════════════════════════════════════════════════════

describe("Composition", () => {
  it("combineAll with all valid → valid array", () => {
    const result = combineAll([valid(1), valid("a"), valid(true)]);
    expect(result).toEqual(valid([1, "a", true]));
  });

  it("combineAll with mixed → invalid, collects all errors", () => {
    const result = combineAll([
      valid(1),
      invalidOne("err A"),
      valid(true),
      invalid(["err B", "err C"]),
    ]);
    expect(result.tag).toBe("invalid");
    expect((result as { errors: string[] }).errors).toEqual([
      "err A",
      "err B",
      "err C",
    ]);
  });

  it("mapValid transforms the value inside valid", () => {
    const result = mapValid(valid(5), (n) => n * 2);
    expect(result).toEqual(valid(10));
  });

  it("mapErrors transforms all error messages", () => {
    const result = mapErrors(invalid(["a", "b"]), (e) => `ERROR: ${e}`);
    expect(result).toEqual(invalid(["ERROR: a", "ERROR: b"]));
  });
});
