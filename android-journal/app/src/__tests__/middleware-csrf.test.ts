/**
 * Edge Middleware — CSRF Exemption Tests
 *
 * CSRF protection exists to stop cross-site requests that ride on
 * ambient (cookie) credentials. Two classes of request carry no such
 * ambient authority and must NOT be blocked:
 *
 *   1. /api/auth/token — the PAT exchange is cookie-free; its secret
 *      lives in the JSON body, which cross-site forms cannot produce.
 *   2. Authorization: Bearer requests — browsers never attach a custom
 *      Authorization header cross-site without a CORS preflight, so
 *      these requests are proof of a non-browser or same-origin client.
 *
 * Everything else keeps the strict Origin check.
 */

import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function makeRequest(
  path: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? "POST",
    headers: opts.headers ?? {},
  });
}

describe("CSRF protection", () => {
  test("POST to /api/* without Origin → 403", async () => {
    const res = middleware(makeRequest("/api/papers"));
    expect(res.status).toBe(403);
  });

  test("POST to /api/* with cross-site Origin → 403", async () => {
    const res = middleware(
      makeRequest("/api/papers", { headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });

  test("POST to /api/* with same Origin → passes", async () => {
    const res = middleware(
      makeRequest("/api/papers", { headers: { origin: "http://localhost:3000" } }),
    );
    expect(res.status).not.toBe(403);
  });

  test("GET to /api/* without Origin → passes (safe method)", async () => {
    const res = middleware(makeRequest("/api/papers", { method: "GET" }));
    expect(res.status).not.toBe(403);
  });

  test("POST /api/auth/token without Origin → passes (cookie-free endpoint)", async () => {
    const res = middleware(makeRequest("/api/auth/token"));
    expect(res.status).not.toBe(403);
  });

  test("POST to /api/* with Bearer header, no Origin → passes (agent CLI)", async () => {
    const res = middleware(
      makeRequest("/api/papers", {
        headers: { authorization: "Bearer some-jwt" },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  test("POST with non-Bearer Authorization scheme still requires Origin", async () => {
    const res = middleware(
      makeRequest("/api/papers", {
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
