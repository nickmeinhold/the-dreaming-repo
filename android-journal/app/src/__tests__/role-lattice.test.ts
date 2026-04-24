/**
 * Role Hierarchy — Galois Connection Properties
 *
 * CATEGORY THEORY:
 *   The role hierarchy (user ≤ editor ≤ admin) is a total order.
 *   The access check withRole(required) defines a Galois connection:
 *     hasAccess(role, req) ⟺ level(role) ≥ level(req)
 *
 *   Properties tested:
 *     - Reflexivity: every role grants access to its own level
 *     - Monotonicity in role: higher role ⟹ more access
 *     - Anti-monotonicity in requirement: higher requirement ⟹ less access
 *     - Transitivity: access propagates up the hierarchy
 *     - Completeness: every (role, required) pair is decidable
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("next/server", () => {
  class MockNextResponse {
    body: unknown;
    status: number;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

import { withRole } from "@/lib/middleware/with-role";
import { NextResponse } from "next/server";
import type { Role } from "@/lib/middleware/types";

// ── Helpers ───────────────────────────────────────────────

function makeCtx(role: Role) {
  return {
    request: {} as never,
    correlationId: "test-123",
    ip: "127.0.0.1",
    userAgent: "test-agent",
    userId: 1,
    githubLogin: "testuser",
    role,
  };
}

function isBlocked(result: unknown): boolean {
  return result instanceof NextResponse;
}

// ── Ordered roles ─────────────────────────────────────────

const ROLES: Role[] = ["user", "editor", "admin"];
const LEVEL: Record<Role, number> = { user: 0, editor: 1, admin: 2 };

// ═══════════════════════════════════════════════════════════
//  GALOIS CONNECTION PROPERTIES
// ═══════════════════════════════════════════════════════════

describe("Role Lattice — Galois Connection", () => {
  describe("Reflexivity: every role grants access to its own level", () => {
    it.each(ROLES)("%s can access %s-level routes", async (role) => {
      const mw = withRole(role);
      const result = await mw(makeCtx(role));
      expect(isBlocked(result)).toBe(false);
    });
  });

  describe("Monotonicity in role: if role₁ ≤ role₂ and role₁ has access, then role₂ has access", () => {
    it("admin has access to everything editor has access to", async () => {
      for (const required of ROLES) {
        const mw = withRole(required);
        const editorResult = await mw(makeCtx("editor"));
        const adminResult = await mw(makeCtx("admin"));

        if (!isBlocked(editorResult)) {
          expect(isBlocked(adminResult)).toBe(false);
        }
      }
    });

    it("editor has access to everything user has access to", async () => {
      for (const required of ROLES) {
        const mw = withRole(required);
        const userResult = await mw(makeCtx("user"));
        const editorResult = await mw(makeCtx("editor"));

        if (!isBlocked(userResult)) {
          expect(isBlocked(editorResult)).toBe(false);
        }
      }
    });
  });

  describe("Anti-monotonicity in requirement: higher requirement → fewer roles pass", () => {
    it("more roles pass 'user' than 'editor'", async () => {
      const passUser: Role[] = [];
      for (const r of ROLES) {
        if (!isBlocked(await withRole("user")(makeCtx(r)))) passUser.push(r);
      }
      const passEditor: Role[] = [];
      for (const r of ROLES) {
        if (!isBlocked(await withRole("editor")(makeCtx(r)))) passEditor.push(r);
      }
      expect(passUser.length).toBe(3);    // user, editor, admin
      expect(passEditor.length).toBe(2);  // editor, admin
      expect(passUser.length).toBeGreaterThanOrEqual(passEditor.length);
    });

    it("user cannot access editor routes", async () => {
      expect(isBlocked(await withRole("editor")(makeCtx("user")))).toBe(true);
    });

    it("user cannot access admin routes", async () => {
      expect(isBlocked(await withRole("admin")(makeCtx("user")))).toBe(true);
    });

    it("editor cannot access admin routes", async () => {
      expect(isBlocked(await withRole("admin")(makeCtx("editor")))).toBe(true);
    });
  });

  describe("Transitivity: access is upward-closed", () => {
    it("for each required level, all roles from that level up have access", async () => {
      for (const required of ROLES) {
        const mw = withRole(required);

        for (const actual of ROLES) {
          const result = await mw(makeCtx(actual));
          const shouldHaveAccess = LEVEL[actual] >= LEVEL[required];
          expect(isBlocked(result)).toBe(!shouldHaveAccess);
        }
      }
    });
  });

  describe("Completeness: every (role, requirement) pair is decidable", () => {
    it("all 9 combinations produce a boolean result", async () => {
      for (const required of ROLES) {
        for (const actual of ROLES) {
          const mw = withRole(required);
          const result = await mw(makeCtx(actual));
          expect(typeof isBlocked(result)).toBe("boolean");
        }
      }
    });
  });

  describe("Total order: the role hierarchy is linear (no incomparable elements)", () => {
    it("for any two roles, one has access to the other's level", async () => {
      for (const r1 of ROLES) {
        for (const r2 of ROLES) {
          const r1AccessesR2 = !isBlocked(await withRole(r2)(makeCtx(r1)));
          const r2AccessesR1 = !isBlocked(await withRole(r1)(makeCtx(r2)));

          // Total order: at least one direction grants access
          expect(r1AccessesR2 || r2AccessesR1).toBe(true);
        }
      }
    });
  });
});
