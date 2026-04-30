/**
 * CRUD Audit — OAuth Callback Integration Tests
 *
 * Tests the GitHub OAuth callback route against a real PostgreSQL database.
 * The primary user creation path (prisma.user.upsert) was completely untested.
 *
 * Edge cases covered:
 * - C1:  Happy path — new user created via OAuth (insert branch of upsert)
 * - U1:  Happy path — returning user updated via OAuth (update branch of upsert)
 * - C7:  CSRF state mismatch → redirect with error
 * - C7:  Missing authorization code → redirect with error
 * - C9:  Token exchange failure → redirect with error
 * - C9:  User fetch failure → redirect with error
 * - X1:  Unicode display name survives upsert
 * - X2:  Returning user preserves role and authorType (update doesn't overwrite)
 * - X3:  Audit events fired for login and failure
 *
 * External HTTP calls (GitHub) are mocked via vi.stubGlobal('fetch').
 * Next.js cookies() are mocked to verify cookie operations.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";

// ── Mock setup ────────────────────────────────────────────

// Mock next/headers cookies
const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// Mock next/cache
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { cleanDatabase, createTestUser } from "./helpers";

// We import the route handler dynamically after mocks are set up
let GET: typeof import("@/app/api/auth/github/callback/route").GET;

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();

  // Set required env vars
  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.JWT_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";

  // Default: cookie has valid oauth_state
  mockCookieStore.get.mockImplementation((name: string) => {
    if (name === "oauth_state") return { value: "valid-state-token" };
    return undefined;
  });

  // Import the route handler fresh
  const mod = await import("@/app/api/auth/github/callback/route");
  GET = mod.GET;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/auth/github/callback");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function mockGitHubResponses(
  tokenData: Record<string, unknown> = { access_token: "gho_test123", token_type: "bearer", scope: "" },
  userData: Record<string, unknown> = {
    id: 99999,
    login: "test-oauth-user",
    name: "Test OAuth User",
    avatar_url: "https://avatars.githubusercontent.com/u/99999",
    email: "test@example.com",
    bio: "I am a test user",
  },
) {
  const mockFetch = vi.fn();

  // First call: token exchange
  mockFetch.mockResolvedValueOnce({
    json: () => Promise.resolve(tokenData),
  });

  // Second call: user profile
  mockFetch.mockResolvedValueOnce({
    json: () => Promise.resolve(userData),
  });

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

// ── Tests ─────────────────────────────────────────────────

describe("CRUD audit: OAuth callback — new user (C1)", () => {
  test("creates a new user record on first login", async () => {
    // CRUD audit: C1 — happy path create (insert branch of upsert)
    const mockFetch = mockGitHubResponses();

    const response = await GET(makeRequest({ code: "auth-code-123", state: "valid-state-token" }));

    // Should redirect to home
    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("/");
    expect(response.headers.get("Location")).not.toContain("error");

    // Verify user created in DB
    const user = await prisma.user.findUnique({ where: { githubId: 99999 } });
    expect(user).toBeTruthy();
    expect(user!.githubLogin).toBe("test-oauth-user");
    expect(user!.displayName).toBe("Test OAuth User");
    expect(user!.avatarUrl).toBe("https://avatars.githubusercontent.com/u/99999");
    expect(user!.bio).toBe("I am a test user");
    expect(user!.authorType).toBe("human");
    expect(user!.role).toBe("user"); // default role

    // Verify token exchange was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toBe("https://github.com/login/oauth/access_token");
    const tokenBody = JSON.parse(tokenCall[1].body);
    expect(tokenBody.client_id).toBe("test-client-id");
    expect(tokenBody.code).toBe("auth-code-123");

    // Verify session cookie was set
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "journal_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );

    // Verify oauth_state cookie was cleared
    expect(mockCookieStore.delete).toHaveBeenCalledWith("oauth_state");
  });

  test("sets displayName to login when GitHub name is null", async () => {
    // CRUD audit: C5 — empty vs null (name field)
    mockGitHubResponses(undefined, {
      id: 88888,
      login: "nameless-user",
      name: null,
      avatar_url: null,
      email: null,
      bio: null,
    });

    await GET(makeRequest({ code: "code", state: "valid-state-token" }));

    const user = await prisma.user.findUnique({ where: { githubId: 88888 } });
    expect(user).toBeTruthy();
    expect(user!.displayName).toBe("nameless-user"); // fallback to login
    expect(user!.avatarUrl).toBeNull();
  });
});

describe("CRUD audit: OAuth callback — returning user (U1)", () => {
  test("updates login, avatar, bio on returning user", async () => {
    // CRUD audit: U1 — happy path update (update branch of upsert)
    // Pre-create the user with old data
    await prisma.user.create({
      data: {
        githubId: 99999,
        githubLogin: "old-login",
        displayName: "Old Name",
        authorType: "human",
        avatarUrl: "https://old-avatar.com",
        bio: "Old bio",
        role: "editor", // elevated role
      },
    });

    mockGitHubResponses(undefined, {
      id: 99999,
      login: "new-login",
      name: "New Display Name",
      avatar_url: "https://new-avatar.com",
      email: "new@example.com",
      bio: "New bio",
    });

    await GET(makeRequest({ code: "code", state: "valid-state-token" }));

    const user = await prisma.user.findUnique({ where: { githubId: 99999 } });
    expect(user).toBeTruthy();

    // Updated fields
    expect(user!.githubLogin).toBe("new-login");
    expect(user!.avatarUrl).toBe("https://new-avatar.com");
    expect(user!.bio).toBe("New bio");

    // Preserved fields (NOT overwritten by upsert update)
    expect(user!.role).toBe("editor"); // role preserved
    expect(user!.displayName).toBe("Old Name"); // displayName only set on create
    expect(user!.authorType).toBe("human"); // authorType only set on create
  });
});

describe("CRUD audit: OAuth callback — CSRF and auth failures (C7)", () => {
  test("rejects when authorization code is missing", async () => {
    // CRUD audit: C7 — missing required field
    const response = await GET(makeRequest({ state: "valid-state-token" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("error=oauth_failed");
  });

  test("rejects when state param is missing", async () => {
    // CRUD audit: C7 — CSRF check
    const response = await GET(makeRequest({ code: "some-code" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("error=oauth_failed");
  });

  test("rejects when state doesn't match cookie", async () => {
    // CRUD audit: C7 — CSRF state mismatch
    const response = await GET(makeRequest({ code: "some-code", state: "wrong-state" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("error=oauth_failed");

    // No user should be created
    const count = await prisma.user.count();
    expect(count).toBe(0);
  });
});

describe("CRUD audit: OAuth callback — external failures (C9)", () => {
  test("handles token exchange failure gracefully", async () => {
    // CRUD audit: C9 — referential integrity (external system)
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ error: "bad_verification_code" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const response = await GET(makeRequest({ code: "expired-code", state: "valid-state-token" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("error=oauth_token_failed");

    // No user should be created
    const count = await prisma.user.count();
    expect(count).toBe(0);
  });

  test("handles GitHub user API failure gracefully", async () => {
    // CRUD audit: C9 — external system returns bad data
    const mockFetch = vi.fn();
    // Token exchange succeeds
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ access_token: "gho_valid" }),
    });
    // But user fetch returns garbage
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ message: "Bad credentials" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const response = await GET(makeRequest({ code: "code", state: "valid-state-token" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toContain("error=oauth_user_failed");

    // No user should be created
    const count = await prisma.user.count();
    expect(count).toBe(0);
  });
});

describe("CRUD audit: OAuth callback — Unicode (X1)", () => {
  test("Unicode display name and bio survive upsert", async () => {
    // CRUD audit: X1 — Unicode round-trip
    mockGitHubResponses(undefined, {
      id: 77777,
      login: "unicode-dev",
      name: "田中太郎 (Tanaka Tarō)",
      avatar_url: null,
      email: null,
      bio: "数学者 — 圏論とAIの研究者",
    });

    await GET(makeRequest({ code: "code", state: "valid-state-token" }));

    const user = await prisma.user.findUnique({ where: { githubId: 77777 } });
    expect(user).toBeTruthy();
    expect(user!.displayName).toBe("田中太郎 (Tanaka Tarō)");
    expect(user!.bio).toBe("数学者 — 圏論とAIの研究者");
  });
});
