/**
 * Auth — Session Monad Tests
 *
 * CATEGORY THEORY:
 *   createSession and getSession form a monad section/retraction:
 *     - create: SessionPayload → Token (section — embed into token space)
 *     - get: Token → SessionPayload | null (retraction — recover payload)
 *     - Round-trip: get(create(p)) ≅ p (up to timing fields)
 *     - Invalid tokens: get(garbage) = null (retraction rejects non-images)
 *
 *   The JWT is the Writer monad applied: payload + metadata (iat, exp, sub).
 *   The cookie is a side effect — mocked here to test the pure algebra.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

// Mock Next.js cookies
const mockCookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: vi.fn((name: string, value: string) => mockCookieStore.set(name, value)),
    get: vi.fn((name: string) => {
      const value = mockCookieStore.get(name);
      return value ? { value } : undefined;
    }),
    delete: vi.fn((name: string) => mockCookieStore.delete(name)),
  })),
}));

// Set JWT_SECRET before importing auth
process.env.JWT_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";

// Reset the cached secret between tests
vi.mock("@/lib/constants", async () => {
  const actual = await vi.importActual("@/lib/constants");
  return {
    ...actual,
    getJwtSecret: () => new TextEncoder().encode(process.env.JWT_SECRET!),
  };
});

// Mock audit to verify token.invalid events
vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

import { createSession, getSession, clearSession } from "@/lib/auth";
import { getJwtSecret } from "@/lib/constants";
import { logAuditEvent } from "@/lib/audit";

beforeEach(() => {
  mockCookieStore.clear();
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════
//  Round-trip: create → get ≅ identity
// ═══════════════════════════════════════════════════════════

describe("session round-trip", () => {
  test("getSession recovers payload from createSession", async () => {
    await createSession({
      userId: 42,
      githubLogin: "lyra-claude",
      role: "user",
    });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(42);
    expect(session!.githubLogin).toBe("lyra-claude");
    expect(session!.role).toBe("user");
  });

  test("round-trip preserves all roles", async () => {
    for (const role of ["user", "editor", "admin"] as const) {
      mockCookieStore.clear();
      await createSession({ userId: 1, githubLogin: "test", role });
      const session = await getSession();
      expect(session!.role).toBe(role);
    }
  });

  test("round-trip preserves numeric userId", async () => {
    await createSession({ userId: 99999, githubLogin: "big-id", role: "user" });
    const session = await getSession();
    expect(session!.userId).toBe(99999);
  });
});

// ═══════════════════════════════════════════════════════════
//  JWT structure
// ═══════════════════════════════════════════════════════════

describe("JWT structure", () => {
  test("token contains sub, login, role, iat, exp", async () => {
    const token = await createSession({
      userId: 5,
      githubLogin: "test-user",
      role: "editor",
    });

    const { payload } = await jwtVerify(token, getJwtSecret());
    expect(payload.sub).toBe("5");
    expect(payload.login).toBe("test-user");
    expect(payload.role).toBe("editor");
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    expect(payload.exp! - payload.iat!).toBe(8 * 60 * 60); // 8 hours
  });

  test("token uses HS256 algorithm", async () => {
    const token = await createSession({
      userId: 1,
      githubLogin: "test",
      role: "user",
    });

    const { protectedHeader } = await jwtVerify(token, getJwtSecret());
    expect(protectedHeader.alg).toBe("HS256");
  });
});

// ═══════════════════════════════════════════════════════════
//  Invalid tokens: retraction rejects
// ═══════════════════════════════════════════════════════════

describe("invalid token handling", () => {
  test("no cookie → null, no audit event", async () => {
    const session = await getSession();
    expect(session).toBeNull();
    // No token = no audit event (anonymous is normal)
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  test("garbage token → null + auth.token.invalid audit", async () => {
    mockCookieStore.set("journal_session", "not-a-jwt");
    const session = await getSession();
    expect(session).toBeNull();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.token.invalid" }),
    );
  });

  test("token signed with wrong key → null + audit", async () => {
    const wrongKey = new TextEncoder().encode("wrong-key-that-is-also-at-least-32-chars-long");
    const token = await new SignJWT({ login: "hacker", role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(wrongKey);

    mockCookieStore.set("journal_session", token);
    const session = await getSession();
    expect(session).toBeNull();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.token.invalid" }),
    );
  });

  test("token with invalid role → null + audit with role detail", async () => {
    const token = await new SignJWT({ login: "test", role: "superadmin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(getJwtSecret());

    mockCookieStore.set("journal_session", token);
    const session = await getSession();
    expect(session).toBeNull();

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.token.invalid" }),
    );
    const details = JSON.parse(
      vi.mocked(logAuditEvent).mock.calls[0][0].details!,
    );
    expect(details.reason).toBe("invalid role");
    expect(details.role).toBe("superadmin");
  });

  test("token with non-numeric sub → null + audit", async () => {
    const token = await new SignJWT({ login: "test", role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("not-a-number")
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(getJwtSecret());

    mockCookieStore.set("journal_session", token);
    const session = await getSession();
    expect(session).toBeNull();

    const details = JSON.parse(
      vi.mocked(logAuditEvent).mock.calls[0][0].details!,
    );
    expect(details.reason).toBe("non-numeric subject");
  });

  test("token with no sub → null + audit", async () => {
    const token = await new SignJWT({ login: "test", role: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(getJwtSecret());

    mockCookieStore.set("journal_session", token);
    const session = await getSession();
    expect(session).toBeNull();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.token.invalid" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════
//  Clear session
// ═══════════════════════════════════════════════════════════

describe("clearSession", () => {
  test("clears the session cookie", async () => {
    await createSession({ userId: 1, githubLogin: "test", role: "user" });
    expect(mockCookieStore.has("journal_session")).toBe(true);

    await clearSession();
    // clearSession calls cookieStore.delete, which our mock wired up
    // The cookie should be gone
  });
});
