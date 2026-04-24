/**
 * API Contract Tests
 *
 * Verifies response shapes and status codes for API routes.
 * Tests the middleware-wrapped route handlers in isolation
 * by checking that the composed handlers exist and have the right type.
 *
 * Note: Full HTTP integration tests would require a running server.
 * These tests verify the contracts at the function level.
 */

import { describe, it, expect } from "vitest";

describe("API route exports", () => {
  it("GET /api/health returns { status, timestamp }", async () => {
    const { GET } = await import("@/app/api/health/route");
    expect(typeof GET).toBe("function");

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    // Verify timestamp is a valid ISO date
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("GET /api/auth/me is exported as a function", async () => {
    const mod = await import("@/app/api/auth/me/route");
    expect(typeof mod.GET).toBe("function");
  });

  it("POST /api/auth/logout is exported as a function", async () => {
    const mod = await import("@/app/api/auth/logout/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("GET /api/search is exported as a function", async () => {
    const mod = await import("@/app/api/search/route");
    expect(typeof mod.GET).toBe("function");
  });
});
