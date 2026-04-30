/**
 * Auth Adapter — Equivariant Map Between User Representations
 *
 * The adapter converts external user representations (GitHub, GitLab, etc.)
 * into the Journal's internal UserUpsertData.
 *
 * This is NOT a natural transformation in the strict sense — the fallback
 * `displayName = name ?? login` makes the compatible transformations depend
 * on the input value (whether name is null), which breaks the universal
 * quantifier that naturality requires.
 *
 * What it IS: an equivariant map with respect to field endomorphisms,
 * where the equivariance splits into two regimes:
 *   - When name ≠ null: fields are independent, any per-field transform commutes
 *   - When name = null: login feeds both githubLogin and displayName,
 *     so transforms on login must be applied to both outputs
 *
 * See auth-natural-transformation.test.ts for property-based verification.
 * See natural-transformation.test.ts for a genuine natural transformation.
 */

// ── External user types ────────────────────────────────────

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  bio: string | null;
}

// ── Internal user types ────────────────────────────────────

export interface UserUpsertData {
  githubId: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  bio: string | null;
  authorType: "human";
}

// ── Adapter interface ──────────────────────────────────────

export interface AuthAdapter<ExternalUser> {
  toJournalUser(external: ExternalUser): UserUpsertData;
}

// ── GitHub implementation ──────────────────────────────────

export class GitHubAuthAdapter implements AuthAdapter<GitHubUser> {
  toJournalUser(external: GitHubUser): UserUpsertData {
    return {
      githubId: external.id,
      githubLogin: external.login,
      displayName: external.name ?? external.login,
      avatarUrl: external.avatar_url,
      email: external.email,
      bio: external.bio,
      authorType: "human",
    };
  }
}
