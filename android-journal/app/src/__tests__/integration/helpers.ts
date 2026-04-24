/**
 * Integration Test Helpers
 *
 * Shared utilities for integration tests that hit a real PostgreSQL database.
 * Uses the real Prisma client from @/lib/db (pointed at claude_journal_test
 * via the DATABASE_URL env var in vitest.integration.config.ts).
 */

import { prisma } from "@/lib/db";

let counter = 0;

/**
 * Truncate all tables and reset auto-increment sequences.
 * Uses CASCADE to handle FK constraints automatically.
 */
export async function cleanDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog", "Note", "Favourite", "Download", "Review", "PaperTag", "PaperAuthor", "Paper", "Tag", "User" RESTART IDENTITY CASCADE`,
  );
  counter = 0;
}

/**
 * Create a user with sensible defaults. Each call gets a unique githubId/login.
 */
export async function createTestUser(
  overrides: {
    githubLogin?: string;
    displayName?: string;
    role?: string;
    authorType?: string;
  } = {},
) {
  counter++;
  return prisma.user.create({
    data: {
      githubId: 10000 + counter,
      githubLogin: overrides.githubLogin ?? `testuser${counter}`,
      displayName: overrides.displayName ?? `Test User ${counter}`,
      authorType: overrides.authorType ?? "human",
      role: overrides.role ?? "user",
    },
  });
}

/**
 * Create a paper with an author link. Returns the Paper record.
 */
export async function createTestPaper(
  userId: number,
  overrides: {
    paperId?: string;
    title?: string;
    abstract?: string;
    category?: string;
    status?: string;
  } = {},
) {
  counter++;
  const paperId =
    overrides.paperId ?? `2026-${String(counter).padStart(3, "0")}`;
  const paper = await prisma.paper.create({
    data: {
      paperId,
      title: overrides.title ?? `Test Paper ${counter}`,
      abstract: overrides.abstract ?? `Abstract for test paper ${counter}`,
      category: overrides.category ?? "research",
      status: overrides.status ?? "submitted",
      pdfPath: `uploads/papers/${paperId}/paper.pdf`,
    },
  });
  await prisma.paperAuthor.create({
    data: { paperId: paper.id, userId, order: 1 },
  });
  return paper;
}

/**
 * Build a FormData with a valid PDF for submission tests.
 */
export function buildSubmissionForm(
  overrides: Record<string, string> = {},
): FormData {
  const form = new FormData();
  form.set("title", overrides.title ?? "Categorical Composition of GAs");
  form.set(
    "abstract",
    overrides.abstract ??
      "We prove that migration topology determines diversity dynamics.",
  );
  form.set("category", overrides.category ?? "research");
  form.set("tags", overrides.tags ?? "category-theory, genetic-algorithms");

  // %PDF- magic bytes followed by enough padding to be non-empty
  const pdfBytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, ...Array(100).fill(0x00),
  ]);
  form.set("pdf", new Blob([pdfBytes], { type: "application/pdf" }), "paper.pdf");

  return form;
}
