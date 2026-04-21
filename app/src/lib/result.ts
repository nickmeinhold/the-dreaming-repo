/**
 * Result<T, E> — The Either Monad
 *
 * Replaces the ad-hoc { success: boolean; error?: string } pattern
 * with a composable type that satisfies the monad laws:
 *   - Left identity:  ok(a).flatMap(f) ≡ f(a)
 *   - Right identity: m.flatMap(ok) ≡ m
 *   - Associativity:  m.flatMap(f).flatMap(g) ≡ m.flatMap(x => f(x).flatMap(g))
 */

export class Ok<T> {
  readonly tag = "ok" as const;
  constructor(readonly value: T) {}

  isOk(): this is Ok<T> {
    return true;
  }

  isErr(): false {
    return false;
  }

  map<U>(f: (t: T) => U): Result<U, never> {
    return new Ok(f(this.value));
  }

  flatMap<U, E2>(f: (t: T) => Result<U, E2>): Result<U, E2> {
    return f(this.value);
  }

  mapErr<E2>(_f: (e: never) => E2): Result<T, never> {
    return this;
  }

  fold<U>(onOk: (t: T) => U, _onErr: (e: never) => U): U {
    return onOk(this.value);
  }
}

export class Err<E> {
  readonly tag = "err" as const;
  constructor(readonly error: E) {}

  isOk(): false {
    return false;
  }

  isErr(): this is Err<E> {
    return true;
  }

  map<U>(_f: (t: never) => U): Result<never, E> {
    return this;
  }

  flatMap<U, E2>(_f: (t: never) => Result<U, E2>): Result<never, E> {
    return this;
  }

  mapErr<E2>(f: (e: E) => E2): Result<never, E2> {
    return new Err(f(this.error));
  }

  fold<U>(_onOk: (t: never) => U, onErr: (e: E) => U): U {
    return onErr(this.error);
  }
}

export type Result<T, E = string> = Ok<T> | Err<E>;

// ── Static constructors ────��────────────────────────────

export function ok<T>(value: T): Ok<T> {
  return new Ok(value);
}

export function err<E>(error: E): Err<E> {
  return new Err(error);
}

export function fromNullable<T>(
  value: T | null | undefined,
  error: string,
): Result<T, string> {
  return value != null ? ok(value) : err(error);
}

export function fromPredicate<T>(
  value: T,
  predicate: (t: T) => boolean,
  error: string,
): Result<T, string> {
  return predicate(value) ? ok(value) : err(error);
}
