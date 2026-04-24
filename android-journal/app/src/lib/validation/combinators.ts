/**
 * Validation Combinators — Applicative Functor for Error Accumulation
 *
 * Unlike Result (which short-circuits on first error), Validation
 * collects ALL errors. This is the free applicative functor over
 * the error monoid (string[], with concatenation).
 *
 * Applicative laws:
 *   Identity:     pure(id) <*> v ≡ v
 *   Homomorphism: pure(f) <*> pure(x) ≡ pure(f(x))
 *   Composition:  pure(∘) <*> u <*> v <*> w ≡ u <*> (v <*> w)
 *   Interchange:  u <*> pure(y) ≡ pure(f => f(y)) <*> u
 */

// ── Types ──────────────────────────────────────────────────

export type Validation<T> =
  | { readonly tag: "valid"; readonly value: T }
  | { readonly tag: "invalid"; readonly errors: string[] };

// ── Constructors ───────────────────────────────────────────

export function valid<T>(value: T): Validation<T> {
  return { tag: "valid", value };
}

export function invalid(errors: string[]): Validation<never> {
  return { tag: "invalid", errors };
}

export function invalidOne(error: string): Validation<never> {
  return { tag: "invalid", errors: [error] };
}

// ── Applicative operations ─────────────────────────────────

/** pure: lift a value into valid */
export const pure = valid;

/** ap: apply a validated function to a validated argument, accumulating errors */
export function ap<A, B>(
  vf: Validation<(a: A) => B>,
  va: Validation<A>,
): Validation<B> {
  if (vf.tag === "valid" && va.tag === "valid") {
    return valid(vf.value(va.value));
  }
  if (vf.tag === "invalid" && va.tag === "invalid") {
    return invalid([...vf.errors, ...va.errors]);
  }
  if (vf.tag === "invalid") return vf;
  return va as Validation<never>;
}

/** Combine two validations into a pair, accumulating errors */
export function combine<A, B>(
  va: Validation<A>,
  vb: Validation<B>,
): Validation<[A, B]> {
  if (va.tag === "valid" && vb.tag === "valid") {
    return valid([va.value, vb.value]);
  }
  const errors: string[] = [];
  if (va.tag === "invalid") errors.push(...va.errors);
  if (vb.tag === "invalid") errors.push(...vb.errors);
  return invalid(errors);
}

/** Combine an array of validations, accumulating all errors */
export function combineAll(
  vs: Validation<unknown>[],
): Validation<unknown[]> {
  const values: unknown[] = [];
  const errors: string[] = [];

  for (const v of vs) {
    if (v.tag === "valid") values.push(v.value);
    else errors.push(...v.errors);
  }

  return errors.length > 0 ? invalid(errors) : valid(values);
}

/** Map a function over a valid value */
export function mapValid<T, U>(
  v: Validation<T>,
  f: (t: T) => U,
): Validation<U> {
  return v.tag === "valid" ? valid(f(v.value)) : v;
}

/** Transform all error messages */
export function mapErrors<T>(
  v: Validation<T>,
  f: (e: string) => string,
): Validation<T> {
  return v.tag === "invalid" ? invalid(v.errors.map(f)) : v;
}

// ── Primitive validators ───────────────────────────────────

export function required(fieldName: string) {
  return (value: unknown): Validation<string> => {
    if (typeof value === "string" && value.trim().length > 0) {
      return valid(value.trim());
    }
    return invalidOne(`${fieldName} is required`);
  };
}

export function minLength(n: number) {
  return (value: string): Validation<string> => {
    return value.length >= n
      ? valid(value)
      : invalidOne(`Must be at least ${n} characters`);
  };
}

export function maxLength(n: number) {
  return (value: string): Validation<string> => {
    return value.length <= n
      ? valid(value)
      : invalidOne(`Must be at most ${n} characters`);
  };
}

export function pattern(re: RegExp, message: string) {
  return (value: string): Validation<string> => {
    return re.test(value) ? valid(value) : invalidOne(message);
  };
}

export function oneOf<T>(values: readonly T[]) {
  return (value: unknown): Validation<T> => {
    return values.includes(value as T)
      ? valid(value as T)
      : invalidOne(`Must be one of: ${values.join(", ")}`);
  };
}

export function range(min: number, max: number) {
  return (value: unknown): Validation<number> => {
    const n = Number(value);
    if (isNaN(n) || n < min || n > max) {
      return invalidOne(`Must be between ${min} and ${max}`);
    }
    return valid(n);
  };
}

export function predicate<T>(pred: (t: T) => boolean, message: string) {
  return (value: T): Validation<T> => {
    return pred(value) ? valid(value) : invalidOne(message);
  };
}

export function integer(fieldName: string) {
  return (value: unknown): Validation<number> => {
    const n = Number(value);
    return Number.isInteger(n) ? valid(n) : invalidOne(`${fieldName} must be an integer`);
  };
}

// ── Bridge to Result monad ────────────────────────────────

import { ok, err, type Result } from "@/lib/result";

/** Convert a Validation to a Result, joining errors with "; " */
export function validationToResult<T>(v: Validation<T>): Result<T> {
  return v.tag === "valid" ? ok(v.value) : err(v.errors.join("; "));
}
