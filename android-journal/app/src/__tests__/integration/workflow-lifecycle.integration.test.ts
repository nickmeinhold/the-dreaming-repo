/**
 * CLI E2E Workflow Tests — Paper Lifecycle
 *
 * Full multi-step workflows via CLI commands:
 * W1: submit → under-review → assign → review → accept → publish
 * W2: revision cycle with new reviewers
 *
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { runCli, runCliJson, runCliError } from "./cli-helpers";
import { cleanDatabase, createTestUser } from "./helpers";
import { prisma } from "@/lib/db";

const SYNTHETIC_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4 test"),
  Buffer.alloc(100, 0),
]);

const TMP_DIR = resolve(__dirname, "../../../.test-tmp-lifecycle");

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

describe("W1: full lifecycle — submit to published", () => {
  test("happy path: submit → under-review → assign → review → accept → publish", async () => {
    // Setup
    const editor = await createTestUser({ githubLogin: "lc-editor", role: "editor" });
    const author = await createTestUser({ githubLogin: "lc-author" });
    const rev1 = await createTestUser({ githubLogin: "lc-rev1" });
    const rev2 = await createTestUser({ githubLogin: "lc-rev2" });

    const pdfPath = resolve(TMP_DIR, "lifecycle.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    // 1. Submit
    const { data: submitted } = await runCliJson<{ paperId: string }>(
      "paper", "submit",
      "--title", "Lifecycle Test Paper",
      "--abstract", "A test of the full lifecycle.",
      "--category", "research",
      "--pdf", pdfPath,
      "--tags", "testing,lifecycle",
      "--as", "lc-author",
    );
    expect(submitted.paperId).toMatch(/^2026-\d{3}$/);

    // 2. Transition to under-review
    const { data: ur } = await runCliJson(
      "editorial", "status", submitted.paperId, "under-review", "--as", "lc-editor",
    );
    expect(ur).toMatchObject({ status: "under-review" });

    // 3. Assign reviewers
    await runCliJson("editorial", "assign", submitted.paperId, "lc-rev1", "--as", "lc-editor");
    await runCliJson("editorial", "assign", submitted.paperId, "lc-rev2", "--as", "lc-editor");

    // 4. Submit reviews
    await runCliJson("review", "submit", submitted.paperId, ...REVIEW_ACCEPT, "--as", "lc-rev1");
    await runCliJson("review", "submit", submitted.paperId, ...REVIEW_ACCEPT, "--as", "lc-rev2");

    // 5. Accept — reviews become visible
    await runCliJson("editorial", "status", submitted.paperId, "accepted", "--as", "lc-editor");

    const visibleReviews = await prisma.review.findMany({
      where: { paper: { paperId: submitted.paperId } },
    });
    expect(visibleReviews.every((r) => r.visible)).toBe(true);

    // 6. Non-editor can now see reviews
    const { data: shown } = await runCliJson<unknown[]>(
      "review", "show", submitted.paperId, "--as", "lc-author",
    );
    expect(shown).toHaveLength(2);

    // 7. Publish
    await runCliJson("editorial", "status", submitted.paperId, "published", "--as", "lc-editor");

    const published = await prisma.paper.findUnique({ where: { paperId: submitted.paperId } });
    expect(published!.status).toBe("published");
    expect(published!.publishedAt).toBeTruthy();

    // 8. Publicly visible (no --as)
    const { data: pub } = await runCliJson<{ status: string }>("paper", "show", submitted.paperId);
    expect(pub.status).toBe("published");
  });

  test("published paper is terminal — rejects all transitions", async () => {
    const editor = await createTestUser({ githubLogin: "term-ed", role: "editor" });
    const author = await createTestUser({ githubLogin: "term-auth" });
    const pdfPath = resolve(TMP_DIR, "terminal.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { data: sub } = await runCliJson<{ paperId: string }>(
      "paper", "submit", "--title", "Terminal Test", "--abstract", "Test.",
      "--category", "research", "--pdf", pdfPath, "--as", "term-auth",
    );

    // Fast-track to published
    await runCli("editorial", "status", sub.paperId, "under-review", "--as", "term-ed");
    await runCli("editorial", "status", sub.paperId, "accepted", "--as", "term-ed");
    await runCli("editorial", "status", sub.paperId, "published", "--as", "term-ed");

    // All transitions should fail
    for (const target of ["under-review", "revision", "accepted", "submitted"]) {
      const { error } = await runCliError(
        "editorial", "status", sub.paperId, target, "--as", "term-ed",
      );
      expect(error).toContain("Cannot transition");
    }
  });

  test("admin can perform editorial actions", async () => {
    const admin = await createTestUser({ githubLogin: "lc-admin", role: "admin" });
    const author = await createTestUser({ githubLogin: "lc-auth2" });
    const pdfPath = resolve(TMP_DIR, "admin.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    const { data: sub } = await runCliJson<{ paperId: string }>(
      "paper", "submit", "--title", "Admin Test", "--abstract", "Test.",
      "--category", "research", "--pdf", pdfPath, "--as", "lc-auth2",
    );

    const { data } = await runCliJson(
      "editorial", "status", sub.paperId, "under-review", "--as", "lc-admin",
    );
    expect(data).toMatchObject({ status: "under-review" });
  });
});

describe("W2: revision cycle", () => {
  test("revision cycle requires new reviewers", async () => {
    const editor = await createTestUser({ githubLogin: "rev-editor", role: "editor" });
    const author = await createTestUser({ githubLogin: "rev-author" });
    const rev1 = await createTestUser({ githubLogin: "rev-r1" });
    const rev2 = await createTestUser({ githubLogin: "rev-r2" });
    const rev3 = await createTestUser({ githubLogin: "rev-r3" });
    const rev4 = await createTestUser({ githubLogin: "rev-r4" });

    const pdfPath = resolve(TMP_DIR, "revision.pdf");
    writeFileSync(pdfPath, SYNTHETIC_PDF);

    // Submit and move to under-review
    const { data: sub } = await runCliJson<{ paperId: string }>(
      "paper", "submit", "--title", "Revision Paper", "--abstract", "Will be revised.",
      "--category", "research", "--pdf", pdfPath, "--as", "rev-author",
    );
    await runCli("editorial", "status", sub.paperId, "under-review", "--as", "rev-editor");

    // Round 1: assign and review with major-revision
    await runCli("editorial", "assign", sub.paperId, "rev-r1", "--as", "rev-editor");
    await runCli("editorial", "assign", sub.paperId, "rev-r2", "--as", "rev-editor");
    await runCli("review", "submit", sub.paperId, ...REVIEW_MAJOR_REV, "--as", "rev-r1");
    await runCli("review", "submit", sub.paperId, ...REVIEW_MAJOR_REV, "--as", "rev-r2");

    // Move to revision then back to under-review
    await runCli("editorial", "status", sub.paperId, "revision", "--as", "rev-editor");
    await runCli("editorial", "status", sub.paperId, "under-review", "--as", "rev-editor");

    // Re-assigning same reviewers should fail (unique constraint)
    const { error: dupErr } = await runCliError(
      "editorial", "assign", sub.paperId, "rev-r1", "--as", "rev-editor",
    );
    expect(dupErr).toContain("Already assigned");

    // Round 2: assign new reviewers
    await runCli("editorial", "assign", sub.paperId, "rev-r3", "--as", "rev-editor");
    await runCli("editorial", "assign", sub.paperId, "rev-r4", "--as", "rev-editor");
    await runCli("review", "submit", sub.paperId, ...REVIEW_ACCEPT, "--as", "rev-r3");
    await runCli("review", "submit", sub.paperId, ...REVIEW_ACCEPT, "--as", "rev-r4");

    // Accept — ALL non-pending reviews become visible (4 reviews)
    await runCli("editorial", "status", sub.paperId, "accepted", "--as", "rev-editor");

    const reviews = await prisma.review.findMany({
      where: { paper: { paperId: sub.paperId } },
    });
    const visible = reviews.filter((r) => r.visible);
    expect(visible).toHaveLength(4); // both rounds

    // Publish
    await runCli("editorial", "status", sub.paperId, "published", "--as", "rev-editor");
    const paper = await prisma.paper.findUnique({ where: { paperId: sub.paperId } });
    expect(paper!.status).toBe("published");
    expect(paper!.publishedAt).toBeTruthy();
  });
});
