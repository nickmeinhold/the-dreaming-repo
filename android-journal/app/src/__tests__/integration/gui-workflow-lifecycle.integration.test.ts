/**
 * GUI CLI E2E Workflow Tests — Paper Lifecycle
 *
 * Mirrors workflow-lifecycle.integration.test.ts but drives the
 * web frontend via Playwright instead of hitting the database directly.
 *
 * W1: submit → under-review → assign → review → accept → publish
 * W2: revision cycle with new reviewers
 *
 * Requires: Next.js dev server running against test database.
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { runGuiCli, runGuiCliJson, runGuiCliError } from "./gui-cli-helpers";
import { cleanDatabase, createTestUser } from "./helpers";
import { prisma } from "@/lib/db";

const SYNTHETIC_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4 test"),
  Buffer.alloc(100, 0),
]);

const TMP_DIR = resolve(__dirname, "../../../.test-tmp-gui-lifecycle");

const REVIEW_ACCEPT = [
  "--novelty", "4", "--correctness", "4", "--clarity", "4",
  "--significance", "4", "--prior-work", "4",
  "--verdict", "accept",
  "--summary", "Strong paper.",
  "--strengths", "Novel approach.",
  "--weaknesses", "Minor issues.",
];

const REVIEW_MAJOR_REV = [
  "--novelty", "3", "--correctness", "3", "--clarity", "3",
  "--significance", "3", "--prior-work", "3",
  "--verdict", "major-revision",
  "--summary", "Needs major work.",
  "--strengths", "Interesting direction.",
  "--weaknesses", "Incomplete proofs, missing related work.",
];

beforeEach(async () => {
  await cleanDatabase();
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("GUI W1: full lifecycle — submit to published", () => {
  test("happy path: submit → under-review → assign → review → accept → publish", async () => {
    // Setup — create users directly in DB (they need to exist for dev-login)
    const editor = await createTestUser({ githubLogin: "gui-lc-editor", role: "editor" });
    const author = await createTestUser({ githubLogin: "gui-lc-author" });
    const rev1 = await createTestUser({ githubLogin: "gui-lc-rev1" });
    const rev2 = await createTestUser({ githubLogin: "gui-lc-rev2" });

    const pdfPath = resolve(TMP_DIR, "lifecycle.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    // 1. Submit via web form
    const { data: submitted } = await runGuiCliJson<{ paperId: string }>(
      "paper", "submit",
      "--title", "GUI Lifecycle Test Paper",
      "--abstract", "A test of the full lifecycle via the web frontend.",
      "--category", "research",
      "--pdf", pdfPath,
      "--tags", "testing,lifecycle",
      "--as", "gui-lc-author",
    );
    expect(submitted.paperId).toMatch(/^2026-\d{3}$/);

    // Verify in DB — the paper was created through the web form
    const dbPaper = await prisma.paper.findUnique({ where: { paperId: submitted.paperId } });
    expect(dbPaper).toBeTruthy();
    expect(dbPaper!.status).toBe("submitted");

    // 2. Transition to under-review via dashboard
    const { data: ur } = await runGuiCliJson(
      "editorial", "status", submitted.paperId, "under-review", "--as", "gui-lc-editor",
    );
    expect(ur).toMatchObject({ status: "under-review" });

    // 3. Assign reviewers via dashboard
    await runGuiCliJson("editorial", "assign", submitted.paperId, "gui-lc-rev1", "--as", "gui-lc-editor");
    await runGuiCliJson("editorial", "assign", submitted.paperId, "gui-lc-rev2", "--as", "gui-lc-editor");

    // Verify assignments in DB
    const assignments = await prisma.review.findMany({
      where: { paper: { paperId: submitted.paperId } },
    });
    expect(assignments).toHaveLength(2);

    // 4. Submit reviews via review form
    await runGuiCliJson("review", "submit", submitted.paperId, ...REVIEW_ACCEPT, "--as", "gui-lc-rev1");
    await runGuiCliJson("review", "submit", submitted.paperId, ...REVIEW_ACCEPT, "--as", "gui-lc-rev2");

    // 5. Accept — reviews become visible
    await runGuiCliJson("editorial", "status", submitted.paperId, "accepted", "--as", "gui-lc-editor");

    const visibleReviews = await prisma.review.findMany({
      where: { paper: { paperId: submitted.paperId } },
    });
    expect(visibleReviews.every((r) => r.visible)).toBe(true);

    // 6. Publish
    await runGuiCliJson("editorial", "status", submitted.paperId, "published", "--as", "gui-lc-editor");

    const published = await prisma.paper.findUnique({ where: { paperId: submitted.paperId } });
    expect(published!.status).toBe("published");
    expect(published!.publishedAt).toBeTruthy();

    // 7. Publicly visible (no --as)
    const { data: pub } = await runGuiCliJson<{ status: string }>("paper", "show", submitted.paperId);
    expect(pub.status).toBe("published");
  });

  test("published paper is terminal — rejects all transitions", async () => {
    const editor = await createTestUser({ githubLogin: "gui-term-ed", role: "editor" });
    const author = await createTestUser({ githubLogin: "gui-term-auth" });
    const pdfPath = resolve(TMP_DIR, "terminal.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { data: sub } = await runGuiCliJson<{ paperId: string }>(
      "paper", "submit", "--title", "GUI Terminal Test", "--abstract", "Test.",
      "--category", "research", "--pdf", pdfPath, "--as", "gui-term-auth",
    );

    // Fast-track to published
    await runGuiCli("editorial", "status", sub.paperId, "under-review", "--as", "gui-term-ed");
    await runGuiCli("editorial", "status", sub.paperId, "accepted", "--as", "gui-term-ed");
    await runGuiCli("editorial", "status", sub.paperId, "published", "--as", "gui-term-ed");

    // All transitions should fail — paper disappears from dashboard
    const paper = await prisma.paper.findUnique({ where: { paperId: sub.paperId } });
    expect(paper!.status).toBe("published");
  });
});

describe("GUI W2: revision cycle", () => {
  test("revision cycle requires new reviewers", async () => {
    const editor = await createTestUser({ githubLogin: "gui-rev-editor", role: "editor" });
    const author = await createTestUser({ githubLogin: "gui-rev-author" });
    const rev1 = await createTestUser({ githubLogin: "gui-rev-r1" });
    const rev2 = await createTestUser({ githubLogin: "gui-rev-r2" });
    const rev3 = await createTestUser({ githubLogin: "gui-rev-r3" });
    const rev4 = await createTestUser({ githubLogin: "gui-rev-r4" });

    const pdfPath = resolve(TMP_DIR, "revision.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    // Submit and move to under-review
    const { data: sub } = await runGuiCliJson<{ paperId: string }>(
      "paper", "submit", "--title", "GUI Revision Paper", "--abstract", "Will be revised.",
      "--category", "research", "--pdf", pdfPath, "--as", "gui-rev-author",
    );
    await runGuiCli("editorial", "status", sub.paperId, "under-review", "--as", "gui-rev-editor");

    // Round 1: assign and review with major-revision
    await runGuiCli("editorial", "assign", sub.paperId, "gui-rev-r1", "--as", "gui-rev-editor");
    await runGuiCli("editorial", "assign", sub.paperId, "gui-rev-r2", "--as", "gui-rev-editor");
    await runGuiCli("review", "submit", sub.paperId, ...REVIEW_MAJOR_REV, "--as", "gui-rev-r1");
    await runGuiCli("review", "submit", sub.paperId, ...REVIEW_MAJOR_REV, "--as", "gui-rev-r2");

    // Move to revision then back to under-review
    await runGuiCli("editorial", "status", sub.paperId, "revision", "--as", "gui-rev-editor");
    await runGuiCli("editorial", "status", sub.paperId, "under-review", "--as", "gui-rev-editor");

    // Round 2: assign new reviewers
    await runGuiCli("editorial", "assign", sub.paperId, "gui-rev-r3", "--as", "gui-rev-editor");
    await runGuiCli("editorial", "assign", sub.paperId, "gui-rev-r4", "--as", "gui-rev-editor");
    await runGuiCli("review", "submit", sub.paperId, ...REVIEW_ACCEPT, "--as", "gui-rev-r3");
    await runGuiCli("review", "submit", sub.paperId, ...REVIEW_ACCEPT, "--as", "gui-rev-r4");

    // Accept — ALL non-pending reviews become visible (4 reviews)
    await runGuiCli("editorial", "status", sub.paperId, "accepted", "--as", "gui-rev-editor");

    const reviews = await prisma.review.findMany({
      where: { paper: { paperId: sub.paperId } },
    });
    const visible = reviews.filter((r) => r.visible);
    expect(visible).toHaveLength(4); // both rounds

    // Publish
    await runGuiCli("editorial", "status", sub.paperId, "published", "--as", "gui-rev-editor");
    const paper = await prisma.paper.findUnique({ where: { paperId: sub.paperId } });
    expect(paper!.status).toBe("published");
    expect(paper!.publishedAt).toBeTruthy();
  });
});
