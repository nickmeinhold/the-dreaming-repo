/**
 * Constants — JWT Secret Validation
 *
 * getJwtSecret is a lazy getter that validates the JWT_SECRET
 * environment variable. Tests verify the security constraints:
 * presence required, minimum length for HS256.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// We need to test getJwtSecret directly, not the mock.
// Since it caches _jwtSecret, we need to re-import for each test.

describe("getJwtSecret", () => {
  const originalEnv = process.env.JWT_SECRET;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.JWT_SECRET = originalEnv;
    } else {
      delete process.env.JWT_SECRET;
    }
    // Clear module cache so _jwtSecret resets
    vi.resetModules();
  });

  test("returns Uint8Array for valid secret", async () => {
    process.env.JWT_SECRET = "a-secret-that-is-definitely-at-least-32-characters-long";
    const { getJwtSecret } = await import("@/lib/constants");
    const secret = getJwtSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  test("throws when JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    const { getJwtSecret } = await import("@/lib/constants");
    expect(() => getJwtSecret()).toThrow("JWT_SECRET environment variable is required");
  });

  test("throws when JWT_SECRET is too short", async () => {
    process.env.JWT_SECRET = "short";
    const { getJwtSecret } = await import("@/lib/constants");
    expect(() => getJwtSecret()).toThrow("at least 32 characters");
  });

  test("caches after first call", async () => {
    process.env.JWT_SECRET = "a-secret-that-is-definitely-at-least-32-characters-long";
    const { getJwtSecret } = await import("@/lib/constants");
    const first = getJwtSecret();
    const second = getJwtSecret();
    expect(first).toBe(second); // same reference
  });
});
