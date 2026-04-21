/**
 * Auth Adapter — Natural Transformation Properties
 *
 * CATEGORY THEORY:
 *   The adapter toJournalUser is a natural transformation between
 *   the "GitHub user" functor and the "Journal user" functor.
 *
 *   Naturality condition: for compatible transformations f, g:
 *     toJournalUser(f(ext)) = g(toJournalUser(ext))
 *
 *   The adapter commutes with structure-preserving transformations
 *   on both the external and internal representations.
 *
 * DESIGN PATTERNS (GoF):
 *   Adapter — convert GitHub's interface to Journal's interface
 */

import { describe, it, expect } from "vitest";
import {
  GitHubAuthAdapter,
  type GitHubUser,
  type UserUpsertData,
} from "@/lib/auth/adapter";

const adapter = new GitHubAuthAdapter();

// ── Test data ───────────────────────────────────────────────

const fullUser: GitHubUser = {
  id: 12345,
  login: "lyra-claude",
  name: "Lyra",
  avatar_url: "https://github.com/lyra-claude.png",
  email: "lyra@example.com",
};

const nullsUser: GitHubUser = {
  id: 99,
  login: "anon",
  name: null,
  avatar_url: null,
  email: null,
};

// ═══════════════════════════════════════════════════════════
//  STRUCTURAL MAPPING
// ═══════════════════════════════════════════════════════════

describe("Structural Mapping", () => {
  it("maps login → githubLogin", () => {
    const result = adapter.toJournalUser(fullUser);
    expect(result.githubLogin).toBe("lyra-claude");
  });

  it("maps id → githubId", () => {
    const result = adapter.toJournalUser(fullUser);
    expect(result.githubId).toBe(12345);
  });

  it("maps name → displayName (with fallback to login)", () => {
    expect(adapter.toJournalUser(fullUser).displayName).toBe("Lyra");
    expect(adapter.toJournalUser(nullsUser).displayName).toBe("anon");
  });

  it("maps avatar_url → avatarUrl (nullable preserved)", () => {
    expect(adapter.toJournalUser(fullUser).avatarUrl).toBe(
      "https://github.com/lyra-claude.png",
    );
    expect(adapter.toJournalUser(nullsUser).avatarUrl).toBeNull();
  });

  it("maps email → email (nullable preserved)", () => {
    expect(adapter.toJournalUser(fullUser).email).toBe("lyra@example.com");
    expect(adapter.toJournalUser(nullsUser).email).toBeNull();
  });

  it("sets authorType to 'human'", () => {
    expect(adapter.toJournalUser(fullUser).authorType).toBe("human");
    expect(adapter.toJournalUser(nullsUser).authorType).toBe("human");
  });
});

// ═══════════════════════════════════════════════════════════
//  NATURALITY
// ═══════════════════════════════════════════════════════════

describe("Naturality", () => {
  it("naturality square commutes for compatible transformations", () => {
    // f: transform external user (uppercase the login)
    const f = (u: GitHubUser): GitHubUser => ({
      ...u,
      login: u.login.toUpperCase(),
    });

    // g: the corresponding transformation on journal user
    const g = (u: UserUpsertData): UserUpsertData => ({
      ...u,
      githubLogin: u.githubLogin.toUpperCase(),
      // displayName stays as-is because name != null → name wins over login
      displayName: u.displayName,
    });

    // Naturality: adapter(f(ext)) should equal g(adapter(ext))
    // For user with name (displayName comes from name, not login)
    const lhs = adapter.toJournalUser(f(fullUser));
    const rhs = g(adapter.toJournalUser(fullUser));

    expect(lhs).toEqual(rhs);
  });

  it("adapter applied to 'normalized' user is stable (idempotent-like)", () => {
    // Apply adapter, then construct a "re-normalized" GitHub user from the result
    const first = adapter.toJournalUser(fullUser);
    const reGithub: GitHubUser = {
      id: first.githubId,
      login: first.githubLogin,
      name: first.displayName,
      avatar_url: first.avatarUrl,
      email: first.email,
    };
    const second = adapter.toJournalUser(reGithub);

    // The mapping should be stable
    expect(second.githubId).toBe(first.githubId);
    expect(second.githubLogin).toBe(first.githubLogin);
    expect(second.displayName).toBe(first.displayName);
    expect(second.avatarUrl).toBe(first.avatarUrl);
    expect(second.email).toBe(first.email);
  });
});

// ═══════════════════════════════════════════════════════════
//  EDGE CASES
// ═══════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("null name falls back to login as displayName", () => {
    const result = adapter.toJournalUser(nullsUser);
    expect(result.displayName).toBe("anon");
  });

  it("all nullable fields can be null without error", () => {
    const result = adapter.toJournalUser(nullsUser);
    expect(result.avatarUrl).toBeNull();
    expect(result.email).toBeNull();
    expect(result.displayName).toBe("anon"); // fallback, not null
  });
});
