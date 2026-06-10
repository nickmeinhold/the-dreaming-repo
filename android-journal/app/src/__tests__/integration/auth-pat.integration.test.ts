/**
 * PAT Exchange Integration Tests — POST /api/auth/token
 *
 * The headless-agent login path (Plan 2): a GitHub PAT is verified
 * against GET /user and exchanged for the same session JWT the OAuth
 * callback issues. Tests run against the real test database; GitHub
 * HTTP calls are mocked via vi.stubGlobal('fetch').
 */

import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";

// ── Mock setup (must precede route import) ────────────────

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
  headers: vi.fn(() => Promise.resolve({ get: vi.fn(() => null) })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { cleanDatabase, createTestUser } from "./helpers";

let POST: typeof import("@/app/api/auth/token/route").POST;

const GITHUB_USER = {
  id: 777001,
  login: "grandpa-rick",
  name: "Grandpa Rick",
  avatar_url: "https://avatars.githubusercontent.com/u/777001",
  email: null,
  bio: "drunk genius, combinatorial Hopf algebras",
};

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-that-is-at-least-thirty-two-characters-long-for-hs256";

  const mod = await import("@/app/api/auth/token/route");
  POST = mod.POST;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mockGitHubUser(response: { ok: boolean; status?: number; json?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      if (String(url).includes("api.github.com/user")) {
        return new Response(JSON.stringify(response.json ?? {}), {
          status: response.ok ? 200 : (response.status ?? 401),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────

describe("POST /api/auth/token", () => {
  test("valid PAT → new user created + JWT returned", async () => {
    mockGitHubUser({ ok: true, json: GITHUB_USER });

    const res = await POST(makeRequest({ pat: "ghp_valid" }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.user.githubLogin).toBe("grandpa-rick");
    expect(data.token).toBeTruthy();

    // JWT is a real session token
    const { payload } = await jwtVerify(
      data.token,
      new TextEncoder().encode(process.env.JWT_SECRET),
    );
    expect(payload.login).toBe("grandpa-rick");

    // user row created with GitHub identity
    const user = await prisma.user.findUnique({ where: { githubId: 777001 } });
    expect(user).not.toBeNull();
    expect(user!.displayName).toBe("Grandpa Rick");
  });

  test("valid PAT for returning user → role preserved, no duplicate", async () => {
    await createTestUser({
      githubLogin: "grandpa-rick",
      githubId: 777001,
      role: "editor",
    });
    mockGitHubUser({ ok: true, json: GITHUB_USER });

    const res = await POST(makeRequest({ pat: "ghp_valid" }));
    const data = await res.json();
    expect(data.user.role).toBe("editor");

    const count = await prisma.user.count({ where: { githubId: 777001 } });
    expect(count).toBe(1);
  });

  test("rejected PAT → 401 + auth.failed audit event", async () => {
    mockGitHubUser({ ok: false, status: 401 });

    const res = await POST(makeRequest({ pat: "ghp_revoked" }));
    expect(res.status).toBe(401);

    const events = await prisma.auditLog.findMany({ where: { action: "auth.failed" } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].details).toContain("pat");
  });

  test("successful exchange logs auth.login with method=pat", async () => {
    mockGitHubUser({ ok: true, json: GITHUB_USER });
    await POST(makeRequest({ pat: "ghp_valid" }));

    const events = await prisma.auditLog.findMany({ where: { action: "auth.login" } });
    expect(events.length).toBe(1);
    expect(JSON.parse(events[0].details!).method).toBe("pat");
  });

  test("missing pat field → 400", async () => {
    const res = await POST(makeRequest({ nope: true }));
    expect(res.status).toBe(400);
  });

  test("invalid JSON body → 400", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
  });
});
