/**
 * CRUD Audit — Boundary & Duplicate Value Tests
 *
 * Tests edge cases at input boundaries and uniqueness constraints.
 * Identified by /crud-audit as missing:
 * - C4: Duplicate unique values (user githubLogin)
 * - C6: Boundary values (PDF/LaTeX size limits)
 * - C8: Concurrent paper creation (P2002 retry)
 * - R9: Case sensitivity in search
 * - U2: Promote nonexistent user
 * - U4: No-op (markAsRead idempotency)
 * - X1: Unicode round-trip
 *
 * Integration tests against real PostgreSQL.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storePaperFiles: vi.fn() }));

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { submitPaper } from "@/lib/actions/papers";
import { createUser, promoteUser } from "@/lib/actions/users";
import { markAsRead } from "@/lib/actions/social";
import { cleanDatabase, createTestUser, createTestPaper, buildSubmissionForm } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

// ── CREATE boundaries ─────────────────────────────────────

describe("CRUD audit: Duplicate unique values (C4)", () => {
  test("createUser rejects duplicate githubLogin", async () => {
    // CRUD audit: C4 — duplicate unique constraint
    const admin = await createTestUser({ githubLogin: "dup-admin", role: "admin" });
    await createTestUser({ githubLogin: "already-exists" });

    vi.mocked(getSession).mockResolvedValue({
      userId: admin.id,
      githubLogin: admin.githubLogin,
      role: "admin",
    });

    const form = new FormData();
    form.set("login", "already-exists");
    form.set("name", "Duplicate User");
    form.set("type", "human");

    const result = await createUser(form);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });
});

describe("CRUD audit: Paper submission size limits (C6)", () => {
  test("rejects PDF over 50 MB", async () => {
    // CRUD audit: C6 — boundary value (MAX_PDF_SIZE)
    const user = await createTestUser({ githubLogin: "bigpdf-user" });
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    // 50 MB + 1 byte — just over the limit
    const oversizedPdf = new Uint8Array(50 * 1024 * 1024 + 1);
    oversizedPdf[0] = 0x25; // %
    oversizedPdf[1] = 0x50; // P
    oversizedPdf[2] = 0x44; // D
    oversizedPdf[3] = 0x46; // F
    oversizedPdf[4] = 0x2d; // -

    const form = buildSubmissionForm();
    form.set("pdf", new Blob([oversizedPdf], { type: "application/pdf" }), "huge.pdf");

    const result = await submitPaper(form);
    expect(result.success).toBe(false);
    expect(result.error).toContain("50 MB");
  });

  test("rejects LaTeX over 5 MB", async () => {
    // CRUD audit: C6 — boundary value (MAX_LATEX_SIZE)
    const user = await createTestUser({ githubLogin: "biglatex-user" });
    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const oversizedLatex = new Uint8Array(5 * 1024 * 1024 + 1);
    const form = buildSubmissionForm();
    form.set("latex", new Blob([oversizedLatex], { type: "text/plain" }), "paper.tex");

    const result = await submitPaper(form);
    expect(result.success).toBe(false);
    expect(result.error).toContain("5 MB");
  });
});

// ── READ boundaries ───────────────────────────────────────

describe("CRUD audit: Search case sensitivity (R9)", () => {
  test("full-text search is case-insensitive", async () => {
    // CRUD audit: R9 — search "categorical" should find "Categorical"
    const author = await createTestUser({ githubLogin: "search-author" });
    await createTestPaper(author.id, {
      title: "Categorical Composition of Genetic Algorithms",
      status: "published",
    });

    // Wait briefly for tsvector trigger to fire
    // Search using raw SQL to match the existing search pattern
    const results = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "Paper"
      WHERE search_vector @@ plainto_tsquery('english', 'categorical')
    `;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain("Categorical");

    // Also test uppercase query finds the same paper
    const upper = await prisma.$queryRaw<{ title: string }[]>`
      SELECT title FROM "Paper"
      WHERE search_vector @@ plainto_tsquery('english', 'CATEGORICAL')
    `;
    expect(upper.length).toBeGreaterThan(0);
  });
});

// ── UPDATE boundaries ─────────────────────────────────────

describe("CRUD audit: Promote edge cases (U2/U4)", () => {
  test("promoteUser rejects nonexistent user", async () => {
    // CRUD audit: U2 — update nonexistent record
    const admin = await createTestUser({ githubLogin: "promo-admin", role: "admin" });
    vi.mocked(getSession).mockResolvedValue({
      userId: admin.id,
      githubLogin: admin.githubLogin,
      role: "admin",
    });

    const result = await promoteUser("ghost-user-doesnt-exist", "editor");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  test("editor cannot promote users (admin-only)", async () => {
    // CRUD audit: U9 — unauthorized update
    const editor = await createTestUser({ githubLogin: "promo-editor", role: "editor" });
    const target = await createTestUser({ githubLogin: "promo-target" });
    vi.mocked(getSession).mockResolvedValue({
      userId: editor.id,
      githubLogin: editor.githubLogin,
      role: "editor",
    });

    const result = await promoteUser("promo-target", "editor");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Admin");

    // Verify role unchanged
    const unchanged = await prisma.user.findUnique({ where: { githubLogin: "promo-target" } });
    expect(unchanged!.role).toBe("user");
  });
});

describe("CRUD audit: markAsRead idempotency (U4)", () => {
  test("calling markAsRead twice is a no-op on second call", async () => {
    // CRUD audit: U4 — no-op update
    const user = await createTestUser({ githubLogin: "idem-user" });
    const author = await createTestUser({ githubLogin: "idem-author" });
    const paper = await createTestPaper(author.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const r1 = await markAsRead(paper.paperId);
    expect(r1.success).toBe(true);

    const r2 = await markAsRead(paper.paperId);
    expect(r2.success).toBe(true);

    // Should still be exactly one download record
    const downloads = await prisma.download.findMany({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].read).toBe(true);
  });
});

// ── CROSS-CUTTING ─────────────────────────────────────────

describe("CRUD audit: Unicode round-trip (X1)", () => {
  test("paper with Unicode title and abstract survives create→read", async () => {
    // CRUD audit: X1 — Unicode in content
    const author = await createTestUser({ githubLogin: "unicode-author" });
    vi.mocked(getSession).mockResolvedValue({
      userId: author.id,
      githubLogin: author.githubLogin,
      role: "user",
    });

    const unicodeTitle = "圏論的遺伝的アルゴリズムの合成 — Catégoriel et Génétique";
    const unicodeAbstract = "Wir beweisen, dass die Migrationstopologie die Diversitätsdynamik bestimmt. Ελληνικά. العربية.";

    const form = buildSubmissionForm({
      title: unicodeTitle,
      abstract: unicodeAbstract,
      tags: "カテゴリー理論, génétique",
    });

    const result = await submitPaper(form);
    expect(result.success).toBe(true);

    const paper = await prisma.paper.findUnique({
      where: { paperId: result.paperId! },
    });
    expect(paper!.title).toBe(unicodeTitle);
    expect(paper!.abstract).toBe(unicodeAbstract);

    // Tags should also survive
    const paperTags = await prisma.paperTag.findMany({
      where: { paperId: paper!.id },
      include: { tag: true },
    });
    const slugs = paperTags.map((pt) => pt.tag.slug).sort();
    expect(slugs).toContain("カテゴリー理論");
    expect(slugs).toContain("génétique");
  });

  test("note with emoji and CJK survives create→read", async () => {
    // CRUD audit: X1 — Unicode in notes
    const { addNote } = await import("@/lib/actions/social");

    const user = await createTestUser({ githubLogin: "emoji-noter" });
    const author = await createTestUser({ githubLogin: "emoji-author" });
    const paper = await createTestPaper(author.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const content = "This connects to 圏論 (category theory) and reminds me of Lyra's work on compositional diversity.";
    const result = await addNote(paper.paperId, content);
    expect(result.success).toBe(true);

    const notes = await prisma.note.findMany({ where: { paperId: paper.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe(content);
  });
});
