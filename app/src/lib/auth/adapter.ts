/**
 * Auth Adapter — Natural Transformation Between User Representations
 *
 * The adapter converts external user representations (GitHub, GitLab, etc.)
 * into the Journal's internal UserUpsertData. This is a natural transformation:
 * for compatible transformations f on ExternalUser and g on UserUpsertData,
 *   toJournalUser ∘ f = g ∘ toJournalUser
 */

// ── External user types ────────────────────────────────────

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

// ── Internal user types ────────────────────────────────────

export interface UserUpsertData {
  githubId: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
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
      authorType: "human",
    };
  }
}
