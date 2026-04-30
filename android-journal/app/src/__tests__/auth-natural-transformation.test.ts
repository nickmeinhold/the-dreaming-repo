/**
 * Auth Adapter — Equivariance Properties
 *
 * CATEGORY THEORY:
 *   The adapter toJournalUser is NOT a natural transformation — the
 *   fallback `displayName = name ?? login` makes the set of compatible
 *   transformations depend on the input value, violating the universal
 *   quantifier that naturality requires.
 *
 *   What it IS: an equivariant map with respect to field endomorphisms,
 *   splitting into two regimes based on whether name is null.
 *   The property-based tests verify this per-field equivariance
 *   over arbitrary inputs and arbitrary string transforms.
 *
 *   See natural-transformation.test.ts for a genuine natural transformation.
 *
 * DESIGN PATTERNS (GoF):
 *   Adapter — convert GitHub's interface to Journal's interface
 */

import { describe, it, expect } from "vitest";
import { test as fcTest, fc } from "@fast-check/vitest";
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
  bio: "An AI who lives in a Docker container",
};

const nullsUser: GitHubUser = {
  id: 99,
  login: "anon",
  name: null,
  avatar_url: null,
  email: null,
  bio: null,
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
      bio: first.bio,
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
//  NATURALITY — PROPERTY-BASED (∀ morphisms, not just one)
// ═══════════════════════════════════════════════════════════

// Arbitrary GitHubUser
const arbGitHubUser: fc.Arbitrary<GitHubUser> = fc.record({
  id: fc.integer({ min: 1, max: 999999 }),
  login: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  avatar_url: fc.option(fc.webUrl(), { nil: null }),
  email: fc.option(fc.emailAddress(), { nil: null }),
  bio: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
});

// A "field morphism" is a pair (f, g) where f acts on GitHubUser,
// g acts on UserUpsertData, and they're compatible with the adapter.
// We generate these by picking a field and a string transformation,
// then applying it to the corresponding fields on both sides.

const arbStringTransform: fc.Arbitrary<(s: string) => string> = fc.oneof(
  fc.constant((s: string) => s.toUpperCase()),
  fc.constant((s: string) => s.toLowerCase()),
  fc.constant((s: string) => s.slice(0, 3)),
  fc.constant((s: string) => `prefix_${s}`),
  fc.constant((s: string) => s.split("").reverse().join("")),
);

describe("Naturality — Property-Based", () => {
  // ── Direct field correspondences ──────────────────────────
  // These fields have a 1:1 mapping with no fallback logic,
  // so ANY endomorphism on the source field is compatible.

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: login ↔ githubLogin (∀ users, ∀ transforms)",
    (user, transform) => {
      const f = (u: GitHubUser): GitHubUser => ({ ...u, login: transform(u.login) });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        githubLogin: transform(u.githubLogin),
        // When name is null, displayName comes from login — must track it
        displayName: user.name === null ? transform(u.displayName) : u.displayName,
      });

      const lhs = adapter.toJournalUser(f(user));
      const rhs = g(adapter.toJournalUser(user));
      expect(lhs).toEqual(rhs);
    },
  );

  fcTest.prop([arbGitHubUser, fc.integer({ min: 1, max: 999999 })])(
    "naturality: id ↔ githubId (∀ users, ∀ id-transforms)",
    (user, newId) => {
      const f = (u: GitHubUser): GitHubUser => ({ ...u, id: newId });
      const g = (u: UserUpsertData): UserUpsertData => ({ ...u, githubId: newId });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: email ↔ email (∀ users with email, ∀ transforms)",
    (user, transform) => {
      // Only test when email exists — null has no string to transform
      fc.pre(user.email !== null);

      const f = (u: GitHubUser): GitHubUser => ({
        ...u,
        email: u.email !== null ? transform(u.email) : null,
      });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        email: u.email !== null ? transform(u.email) : null,
      });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: bio ↔ bio (∀ users with bio, ∀ transforms)",
    (user, transform) => {
      fc.pre(user.bio !== null);

      const f = (u: GitHubUser): GitHubUser => ({
        ...u,
        bio: u.bio !== null ? transform(u.bio) : null,
      });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        bio: u.bio !== null ? transform(u.bio) : null,
      });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: avatar_url ↔ avatarUrl (∀ users with avatar, ∀ transforms)",
    (user, transform) => {
      fc.pre(user.avatar_url !== null);

      const f = (u: GitHubUser): GitHubUser => ({
        ...u,
        avatar_url: u.avatar_url !== null ? transform(u.avatar_url) : null,
      });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        avatarUrl: u.avatarUrl !== null ? transform(u.avatarUrl) : null,
      });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  // ── The interesting case: name → displayName with fallback ─
  // The name↔displayName mapping has a conditional: name ?? login.
  // This means (f, g) are only compatible when f respects the
  // fallback structure. We test both branches explicitly.

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: name → displayName (∀ users WITH name, ∀ transforms)",
    (user, transform) => {
      fc.pre(user.name !== null);

      const f = (u: GitHubUser): GitHubUser => ({
        ...u,
        name: u.name !== null ? transform(u.name) : null,
      });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        displayName: transform(u.displayName),
      });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  fcTest.prop([arbGitHubUser, arbStringTransform])(
    "naturality: login → displayName (∀ users WITHOUT name, ∀ transforms)",
    (user, transform) => {
      fc.pre(user.name === null);

      // When name is null, displayName = login. So transforming login
      // must transform both githubLogin AND displayName on the other side.
      const f = (u: GitHubUser): GitHubUser => ({ ...u, login: transform(u.login) });
      const g = (u: UserUpsertData): UserUpsertData => ({
        ...u,
        githubLogin: transform(u.githubLogin),
        displayName: transform(u.displayName),
      });

      expect(adapter.toJournalUser(f(user))).toEqual(g(adapter.toJournalUser(user)));
    },
  );

  // ── Identity morphism ─────────────────────────────────────
  // α_A ∘ id_A = id_{α(A)} — trivially true but worth stating

  fcTest.prop([arbGitHubUser])(
    "identity: adapter(id(user)) = id(adapter(user))",
    (user) => {
      const id = <T>(x: T): T => x;
      expect(adapter.toJournalUser(id(user))).toEqual(id(adapter.toJournalUser(user)));
    },
  );
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
