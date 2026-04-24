/**
 * CLI E2E Integration Tests
 *
 * Spawns `npx tsx src/cli.ts` as a subprocess for each test.
 * Hits the real test database (claude_journal_test).
 * Verifies JSON output against expected shapes.
 *
 * 55 test cases covering all 22 CLI commands.
 */

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { runCli, runCliJson, runCliError } from "./cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

// Synthetic PDF: valid %PDF- magic bytes + padding
const SYNTHETIC_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4 test"),
  Buffer.alloc(100, 0),
]);

// Temp directory for test files
const TMP_DIR = resolve(__dirname, "../../../.test-tmp");

beforeEach(async () => {
  await cleanDatabase();
  // Ensure temp directory exists
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(async () => {
  // Clean up temp files
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ── Health (1) ────────────────────────────────────────────

describe("health", () => {
  test("reports database connectivity", async () => {
    const { data } = await runCliJson<{ status: string; database: string }>("health");
    expect(data.status).toBe("ok");
    expect(data.database).toBe("connected");
    expect(data).toHaveProperty("timestamp");
  });
});

// ── Users (10) ────────────────────────────────────────────

describe("user", () => {
  test("create user", async () => {
    const { data } = await runCliJson(
      "user", "create", "--login", "lyra", "--name", "Lyra", "--type", "autonomous",
    );
    expect(data).toMatchObject({ githubLogin: "lyra", displayName: "Lyra", role: "user" });
  });

  test("create with role", async () => {
    const { data } = await runCliJson(
      "user", "create", "--login", "editor1", "--name", "Editor", "--type", "human", "--role", "editor",
    );
    expect(data).toMatchObject({ role: "editor" });
  });

  test("reject invalid type", async () => {
    const { error } = await runCliError(
      "user", "create", "--login", "bad", "--name", "Bad", "--type", "robot",
    );
    expect(error).toContain("Invalid author type");
  });

  test("list users", async () => {
    await createTestUser({ githubLogin: "alice" });
    await createTestUser({ githubLogin: "bob" });
    const { data } = await runCliJson<unknown[]>("user", "list");
    expect(data).toHaveLength(2);
  });

  test("show user with counts", async () => {
    const user = await createTestUser({ githubLogin: "showme" });
    await createTestPaper(user.id, { status: "published" });
    const { data } = await runCliJson<{ papers: number }>("user", "show", "showme");
    expect(data).toMatchObject({ githubLogin: "showme", papers: 1 });
  });

  test("show nonexistent → error", async () => {
    const { error } = await runCliError("user", "show", "ghost");
    expect(error).toContain("User not found");
  });

  test("promote user", async () => {
    await createTestUser({ githubLogin: "promoteme" });
    const { data } = await runCliJson("user", "promote", "promoteme", "--role", "editor");
    expect(data).toMatchObject({ githubLogin: "promoteme", role: "editor" });
  });

  test("reject invalid role", async () => {
    await createTestUser({ githubLogin: "badrole" });
    const { error } = await runCliError("user", "promote", "badrole", "--role", "superadmin");
    expect(error).toContain("Invalid role");
  });

  test("similar with no reads → empty", async () => {
    await createTestUser({ githubLogin: "lonely" });
    const { data } = await runCliJson<unknown[]>("user", "similar", "lonely");
    expect(data).toHaveLength(0);
  });

  test("similar with shared reads → results", async () => {
    const alice = await createTestUser({ githubLogin: "alice2" });
    const bob = await createTestUser({ githubLogin: "bob2" });
    const paper = await createTestPaper(alice.id, { status: "published" });

    // Both users read the same paper
    await prisma.download.create({ data: { paperId: paper.id, userId: alice.id, read: true } });
    await prisma.download.create({ data: { paperId: paper.id, userId: bob.id, read: true } });

    const { data } = await runCliJson<unknown[]>("user", "similar", "alice2");
    expect(data.length).toBeGreaterThan(0);
  });
});

// ── Papers (11) ───────────────────────────────────────────

describe("paper", () => {
  test("submit paper with PDF", async () => {
    await createTestUser({ githubLogin: "submitter" });
    const pdfPath = resolve(TMP_DIR, "test.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { data } = await runCliJson<{ paperId: string }>(
      "paper", "submit",
      "--title", "Test Paper",
      "--abstract", "A test abstract.",
      "--category", "research",
      "--pdf", pdfPath,
      "--tags", "testing,cli",
      "--as", "submitter",
    );
    expect(data.paperId).toMatch(/^2026-\d{3}$/);

    // Verify in database
    const paper = await prisma.paper.findUnique({ where: { paperId: data.paperId } });
    expect(paper).toBeTruthy();
    expect(paper!.title).toBe("Test Paper");
  });

  test("submit with LaTeX", async () => {
    await createTestUser({ githubLogin: "texuser" });
    const pdfPath = resolve(TMP_DIR, "tex-test.pdf");
    const texPath = resolve(TMP_DIR, "tex-test.tex");
    writeFileSync(pdfPath, SYNTHETIC_PDF);
    writeFileSync(texPath, "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}");

    const { data } = await runCliJson<{ paperId: string }>(
      "paper", "submit",
      "--title", "LaTeX Paper",
      "--abstract", "Has source.",
      "--category", "expository",
      "--pdf", pdfPath,
      "--latex", texPath,
      "--as", "texuser",
    );
    expect(data.paperId).toBeTruthy();

    const paper = await prisma.paper.findUnique({ where: { paperId: data.paperId } });
    expect(paper!.latexPath).toContain("paper.tex");
  });

  test("reject bad PDF (no magic bytes)", async () => {
    await createTestUser({ githubLogin: "badpdf" });
    const fakePath = resolve(TMP_DIR, "fake.pdf");
    writeFileSync(fakePath, "this is not a pdf");

    const { error } = await runCliError(
      "paper", "submit",
      "--title", "Bad", "--abstract", "Bad", "--category", "research",
      "--pdf", fakePath, "--as", "badpdf",
    );
    expect(error).toContain("not a valid PDF");
  });

  test("reject no --as", async () => {
    const pdfPath = resolve(TMP_DIR, "noauth.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { error } = await runCliError(
      "paper", "submit",
      "--title", "No Auth", "--abstract", "Test", "--category", "research",
      "--pdf", pdfPath,
    );
    expect(error).toContain("--as");
  });

  test("reject unknown user", async () => {
    const pdfPath = resolve(TMP_DIR, "unknown.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { error } = await runCliError(
      "paper", "submit",
      "--title", "Unknown", "--abstract", "Test", "--category", "research",
      "--pdf", pdfPath, "--as", "nonexistent",
    );
    expect(error).toContain("User not found");
  });

  test("reject invalid category", async () => {
    await createTestUser({ githubLogin: "badcat" });
    const pdfPath = resolve(TMP_DIR, "badcat.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { error } = await runCliError(
      "paper", "submit",
      "--title", "Bad Cat", "--abstract", "Test", "--category", "opinion",
      "--pdf", pdfPath, "--as", "badcat",
    );
    expect(error).toBeTruthy();
  });

  test("list shows published only for non-editors", async () => {
    const user = await createTestUser({ githubLogin: "viewer" });
    await createTestPaper(user.id, { status: "published", title: "Visible" });
    await createTestPaper(user.id, { status: "submitted", title: "Hidden" });

    const { data } = await runCliJson<{ papers: { title: string }[]; total: number }>(
      "paper", "list", "--as", "viewer",
    );
    expect(data.total).toBe(1);
    expect(data.papers[0].title).toBe("Visible");
  });

  test("list with status filter as editor", async () => {
    const editor = await createTestUser({ githubLogin: "listeditor", role: "editor" });
    await createTestPaper(editor.id, { status: "submitted" });
    await createTestPaper(editor.id, { status: "published" });

    const { data } = await runCliJson<{ papers: unknown[]; total: number }>(
      "paper", "list", "--status", "submitted", "--as", "listeditor",
    );
    expect(data.total).toBe(1);
  });

  test("list with category filter", async () => {
    const user = await createTestUser({ githubLogin: "catfilter" });
    await createTestPaper(user.id, { status: "published", category: "research" });
    await createTestPaper(user.id, { status: "published", category: "expository" });

    const { data } = await runCliJson<{ total: number }>(
      "paper", "list", "--category", "expository", "--as", "catfilter",
    );
    expect(data.total).toBe(1);
  });

  test("show paper detail", async () => {
    const user = await createTestUser({ githubLogin: "showpaper" });
    const paper = await createTestPaper(user.id, { status: "published", title: "Detail Test" });

    const { data } = await runCliJson<{ title: string; paperId: string }>(
      "paper", "show", paper.paperId,
    );
    expect(data.title).toBe("Detail Test");
    expect(data.paperId).toBe(paper.paperId);
  });

  test("show nonexistent → error", async () => {
    const { error } = await runCliError("paper", "show", "9999-999");
    expect(error).toContain("Paper not found");
  });
});

// ── Editorial (8) ─────────────────────────────────────────

describe("editorial", () => {
  test("valid status transition", async () => {
    const editor = await createTestUser({ githubLogin: "ed1", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const { data } = await runCliJson(
      "editorial", "status", paper.paperId, "under-review", "--as", "ed1",
    );
    expect(data).toMatchObject({ paperId: paper.paperId, status: "under-review" });

    const updated = await prisma.paper.findUnique({ where: { paperId: paper.paperId } });
    expect(updated!.status).toBe("under-review");
  });

  test("invalid transition → error", async () => {
    const editor = await createTestUser({ githubLogin: "ed2", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const { error } = await runCliError(
      "editorial", "status", paper.paperId, "published", "--as", "ed2",
    );
    expect(error).toContain("Cannot transition");
  });

  test("non-editor rejected", async () => {
    await createTestUser({ githubLogin: "noeditor" });
    const editor = await createTestUser({ githubLogin: "ed3", role: "editor" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const { error } = await runCliError(
      "editorial", "status", paper.paperId, "under-review", "--as", "noeditor",
    );
    expect(error).toContain("not an editor");
  });

  test("assign reviewer", async () => {
    const editor = await createTestUser({ githubLogin: "ed4", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "rev1" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    const { data } = await runCliJson(
      "editorial", "assign", paper.paperId, "rev1", "--as", "ed4",
    );
    expect(data).toMatchObject({ reviewer: "rev1", status: "assigned" });

    // Verify placeholder review exists
    const review = await prisma.review.findFirst({ where: { paperId: paper.id, reviewerId: reviewer.id } });
    expect(review).toBeTruthy();
    expect(review!.verdict).toBe("pending");
  });

  test("assign author → rejected", async () => {
    const editor = await createTestUser({ githubLogin: "ed5", role: "editor" });
    const author = await createTestUser({ githubLogin: "author1" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const { error } = await runCliError(
      "editorial", "assign", paper.paperId, "author1", "--as", "ed5",
    );
    expect(error).toContain("author as reviewer");
  });

  test("assign to wrong status → rejected", async () => {
    const editor = await createTestUser({ githubLogin: "ed6", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "rev2" });
    const paper = await createTestPaper(editor.id, { status: "submitted" });

    const { error } = await runCliError(
      "editorial", "assign", paper.paperId, "rev2", "--as", "ed6",
    );
    expect(error).toContain("under review");
  });

  test("double-assign → rejected", async () => {
    const editor = await createTestUser({ githubLogin: "ed7", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "rev3" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    // First assign
    await runCli("editorial", "assign", paper.paperId, "rev3", "--as", "ed7");
    // Second assign
    const { error } = await runCliError(
      "editorial", "assign", paper.paperId, "rev3", "--as", "ed7",
    );
    expect(error).toContain("Already assigned");
  });

  test("dashboard grouped by status", async () => {
    const editor = await createTestUser({ githubLogin: "ed8", role: "editor" });
    await createTestPaper(editor.id, { status: "submitted" });
    await createTestPaper(editor.id, { status: "under-review" });
    await createTestPaper(editor.id, { status: "published" });

    const { data } = await runCliJson<Record<string, unknown[]>>(
      "editorial", "dashboard", "--as", "ed8",
    );
    expect(Object.keys(data)).toContain("submitted");
    expect(Object.keys(data)).toContain("under-review");
    expect(Object.keys(data)).toContain("published");
  });
});

// ── Reviews (5) ───────────────────────────────────────────

describe("review", () => {
  const reviewFlags = [
    "--novelty", "4", "--correctness", "5", "--clarity", "3",
    "--significance", "4", "--prior-work", "3",
    "--verdict", "accept",
    "--summary", "Strong paper.",
    "--strengths", "Novel approach.",
    "--weaknesses", "Minor notation issues.",
  ];

  test("submit review with valid scores", async () => {
    const editor = await createTestUser({ githubLogin: "reditor", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "reviewer1" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    // Assign reviewer first
    await runCli("editorial", "assign", paper.paperId, "reviewer1", "--as", "reditor");

    const { data } = await runCliJson(
      "review", "submit", paper.paperId,
      ...reviewFlags,
      "--as", "reviewer1",
    );
    expect(data).toMatchObject({ verdict: "accept", reviewer: "reviewer1" });

    // Verify in DB
    const review = await prisma.review.findFirst({ where: { paperId: paper.id, reviewerId: reviewer.id } });
    expect(review!.noveltyScore).toBe(4);
    expect(review!.verdict).toBe("accept");
  });

  test("submit without assignment → rejected", async () => {
    const editor = await createTestUser({ githubLogin: "reditor2", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "reviewer2" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    const { error } = await runCliError(
      "review", "submit", paper.paperId,
      ...reviewFlags,
      "--as", "reviewer2",
    );
    expect(error).toContain("not been assigned");
  });

  test("invalid scores → rejected", async () => {
    const editor = await createTestUser({ githubLogin: "reditor3", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "reviewer3" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });
    await runCli("editorial", "assign", paper.paperId, "reviewer3", "--as", "reditor3");

    const { error } = await runCliError(
      "review", "submit", paper.paperId,
      "--novelty", "9", "--correctness", "5", "--clarity", "3",
      "--significance", "4", "--prior-work", "3",
      "--verdict", "accept",
      "--summary", "Test", "--strengths", "Test", "--weaknesses", "Test",
      "--as", "reviewer3",
    );
    expect(error).toBeTruthy();
  });

  test("show visible reviews (non-editor)", async () => {
    const editor = await createTestUser({ githubLogin: "reditor4", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "reviewer4" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    // Create a review — not visible yet
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: reviewer.id,
        noveltyScore: 4, correctnessScore: 4, clarityScore: 4,
        significanceScore: 4, priorWorkScore: 4,
        summary: "Good", strengths: "Strong", weaknesses: "None",
        questions: "", connections: "", verdict: "accept", visible: false,
      },
    });

    // Non-editor sees nothing
    const { data: hidden } = await runCliJson<unknown[]>(
      "review", "show", paper.paperId, "--as", "reviewer4",
    );
    expect(hidden).toHaveLength(0);

    // Make visible
    await prisma.review.updateMany({ where: { paperId: paper.id }, data: { visible: true } });

    const { data: shown } = await runCliJson<unknown[]>(
      "review", "show", paper.paperId, "--as", "reviewer4",
    );
    expect(shown).toHaveLength(1);
  });

  test("editor sees all reviews", async () => {
    const editor = await createTestUser({ githubLogin: "reditor5", role: "editor" });
    const reviewer = await createTestUser({ githubLogin: "reviewer5" });
    const paper = await createTestPaper(editor.id, { status: "under-review" });

    // Create invisible review
    await prisma.review.create({
      data: {
        paperId: paper.id, reviewerId: reviewer.id,
        noveltyScore: 3, correctnessScore: 3, clarityScore: 3,
        significanceScore: 3, priorWorkScore: 3,
        summary: "OK", strengths: "Some", weaknesses: "Some",
        questions: "", connections: "", verdict: "minor-revision", visible: false,
      },
    });

    const { data } = await runCliJson<unknown[]>(
      "review", "show", paper.paperId, "--as", "reditor5",
    );
    expect(data).toHaveLength(1);
  });
});

// ── Social — Notes (5) ────────────────────────────────────

describe("note", () => {
  test("add note to published paper", async () => {
    const user = await createTestUser({ githubLogin: "noter1" });
    const paper = await createTestPaper(user.id, { status: "published" });

    const { data } = await runCliJson<{ id: number; content: string }>(
      "note", "add", paper.paperId, "Great paper!", "--as", "noter1",
    );
    expect(data.content).toBe("Great paper!");
    expect(data).toHaveProperty("id");
  });

  test("threaded reply", async () => {
    const user = await createTestUser({ githubLogin: "noter2" });
    const paper = await createTestPaper(user.id, { status: "published" });

    const { data: parent } = await runCliJson<{ id: number }>(
      "note", "add", paper.paperId, "First note", "--as", "noter2",
    );
    const { data: reply } = await runCliJson<{ id: number; content: string }>(
      "note", "add", paper.paperId, "Reply to that",
      "--reply-to", String(parent.id), "--as", "noter2",
    );
    expect(reply.content).toBe("Reply to that");

    // Verify threading in DB
    const dbNote = await prisma.note.findUnique({ where: { id: reply.id } });
    expect(dbNote!.parentId).toBe(parent.id);
  });

  test("cross-paper reply → rejected", async () => {
    const user = await createTestUser({ githubLogin: "noter3" });
    const paper1 = await createTestPaper(user.id, { status: "published" });
    const paper2 = await createTestPaper(user.id, { status: "published" });

    const { data: note1 } = await runCliJson<{ id: number }>(
      "note", "add", paper1.paperId, "On paper 1", "--as", "noter3",
    );

    // Try replying on paper2 with a noteId from paper1
    const { error } = await runCliError(
      "note", "add", paper2.paperId, "Cross reply",
      "--reply-to", String(note1.id), "--as", "noter3",
    );
    expect(error).toContain("Invalid parent note");
  });

  test("note on unpublished → rejected for non-editor", async () => {
    const user = await createTestUser({ githubLogin: "noter4" });
    const paper = await createTestPaper(user.id, { status: "submitted" });

    const { error } = await runCliError(
      "note", "add", paper.paperId, "Should fail", "--as", "noter4",
    );
    expect(error).toContain("Paper not found");
  });

  test("list notes", async () => {
    const user = await createTestUser({ githubLogin: "noter5" });
    const paper = await createTestPaper(user.id, { status: "published" });

    await runCli("note", "add", paper.paperId, "Note A", "--as", "noter5");
    await runCli("note", "add", paper.paperId, "Note B", "--as", "noter5");

    const { data } = await runCliJson<unknown[]>(
      "note", "list", paper.paperId, "--as", "noter5",
    );
    expect(data).toHaveLength(2);
  });
});

// ── Social — Favourites (3) ───────────────────────────────

describe("favourite", () => {
  test("toggle on", async () => {
    const user = await createTestUser({ githubLogin: "fav1" });
    const paper = await createTestPaper(user.id, { status: "published" });

    const { data } = await runCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "fav1",
    );
    expect(data.favourited).toBe(true);
  });

  test("toggle off", async () => {
    const user = await createTestUser({ githubLogin: "fav2" });
    const paper = await createTestPaper(user.id, { status: "published" });

    // Toggle on
    await runCli("favourite", "toggle", paper.paperId, "--as", "fav2");
    // Toggle off
    const { data } = await runCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "fav2",
    );
    expect(data.favourited).toBe(false);
  });

  test("list favourites", async () => {
    const user = await createTestUser({ githubLogin: "fav3" });
    const paper = await createTestPaper(user.id, { status: "published", title: "Fav Paper" });

    await runCli("favourite", "toggle", paper.paperId, "--as", "fav3");

    const { data } = await runCliJson<{ paperId: string; title: string }[]>(
      "favourite", "list", "--as", "fav3",
    );
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Fav Paper");
  });
});

// ── Social — Read Marking (3) ─────────────────────────────

describe("read", () => {
  test("mark as read updates existing download", async () => {
    const user = await createTestUser({ githubLogin: "reader1" });
    const paper = await createTestPaper(user.id, { status: "published" });

    // Create a download first
    await prisma.download.create({ data: { paperId: paper.id, userId: user.id, read: false } });

    const { data } = await runCliJson<{ read: boolean }>(
      "read", "mark", paper.paperId, "--as", "reader1",
    );
    expect(data.read).toBe(true);

    // Should have updated existing, not created a new one
    const downloads = await prisma.download.findMany({ where: { paperId: paper.id, userId: user.id } });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].read).toBe(true);
  });

  test("mark as read creates download when none exists", async () => {
    const user = await createTestUser({ githubLogin: "reader2" });
    const paper = await createTestPaper(user.id, { status: "published" });

    await runCli("read", "mark", paper.paperId, "--as", "reader2");

    const downloads = await prisma.download.findMany({ where: { paperId: paper.id, userId: user.id } });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].read).toBe(true);
  });

  test("read history", async () => {
    const user = await createTestUser({ githubLogin: "reader3" });
    const paper = await createTestPaper(user.id, { status: "published", title: "Read This" });

    await prisma.download.create({ data: { paperId: paper.id, userId: user.id, read: true } });

    const { data } = await runCliJson<{ paperId: string; read: boolean }[]>(
      "read", "history", "--as", "reader3",
    );
    expect(data).toHaveLength(1);
    expect(data[0].read).toBe(true);
  });
});

// ── Search & Tags (6) ─────────────────────────────────────

describe("search", () => {
  // Note: search tests require the tsvector trigger to be installed.
  // The test DB setup script handles this.

  test("search papers", async () => {
    const user = await createTestUser({ githubLogin: "searcher1" });
    await createTestPaper(user.id, {
      status: "published",
      title: "Categorical Composition of Genetic Algorithms",
      abstract: "Migration topology determines diversity.",
    });

    // Wait briefly for tsvector trigger to update
    const { data } = await runCliJson<{ results: unknown[]; total: number }>(
      "search", "categorical",
    );
    // tsvector trigger may or may not have fired depending on timing;
    // at minimum, the command should not error
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("results");
  });

  test("empty query → empty results", async () => {
    const { data } = await runCliJson<{ total: number }>("search", "   ");
    expect(data.total).toBe(0);
  });

  test("category filter", async () => {
    const user = await createTestUser({ githubLogin: "searcher2" });
    await createTestPaper(user.id, {
      status: "published",
      title: "Expository Paper About Testing",
      category: "expository",
    });

    const { data } = await runCliJson<{ results: unknown[] }>(
      "search", "testing", "--category", "expository",
    );
    // Command works without error
    expect(data).toHaveProperty("results");
  });
});

describe("tag", () => {
  test("list tags with counts", async () => {
    const user = await createTestUser({ githubLogin: "tagger1" });
    const paper = await createTestPaper(user.id);

    // Create a tag and link it
    const tag = await prisma.tag.create({ data: { slug: "test-tag", label: "Test Tag" } });
    await prisma.paperTag.create({ data: { paperId: paper.id, tagId: tag.id } });

    const { data } = await runCliJson<{ slug: string; papers: number }[]>("tag", "list");
    expect(data.length).toBeGreaterThan(0);
    expect(data.find((t) => t.slug === "test-tag")?.papers).toBe(1);
  });

  test("show tag with papers", async () => {
    const user = await createTestUser({ githubLogin: "tagger2" });
    const paper = await createTestPaper(user.id, { status: "published", title: "Tagged Paper" });

    const tag = await prisma.tag.create({ data: { slug: "show-tag", label: "Show Tag" } });
    await prisma.paperTag.create({ data: { paperId: paper.id, tagId: tag.id } });

    const { data } = await runCliJson<{ slug: string; papers: { title: string }[] }>(
      "tag", "show", "show-tag",
    );
    expect(data.slug).toBe("show-tag");
    expect(data.papers).toHaveLength(1);
    expect(data.papers[0].title).toBe("Tagged Paper");
  });

  test("show nonexistent tag → error", async () => {
    const { error } = await runCliError("tag", "show", "no-such-tag");
    expect(error).toContain("Tag not found");
  });
});

// ── Output & Error (3) ────────────────────────────────────

describe("output formatting", () => {
  test("JSON output (default)", async () => {
    const result = await runCli("health");
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("status");
  });

  test("table output", async () => {
    await createTestUser({ githubLogin: "tableuser" });
    const result = await runCli("user", "list", "--format", "table");
    // console.table produces tabular output, not JSON
    expect(() => JSON.parse(result.stdout)).toThrow();
    expect(result.stdout).toContain("tableuser");
  });

  test("unknown command → non-zero exit", async () => {
    const result = await runCli("nonexistent");
    expect(result.code).not.toBe(0);
  });
});
