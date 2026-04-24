/**
 * CLI E2E Workflow Tests — Paper Download
 *
 * Gap G1 from WORKFLOWS.md — `paper download` was completely untested.
 * Tests PDF download, LaTeX download, error paths, and download logging.
 *
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { runCli, runCliJson, runCliError } from "./cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

const SYNTHETIC_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4 test"),
  Buffer.alloc(100, 0),
]);

const SYNTHETIC_TEX = Buffer.from(
  "\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}\n",
);

const TMP_DIR = resolve(__dirname, "../../../.test-tmp-download");
const UPLOADS_DIR = resolve(__dirname, "../../../uploads/papers");

beforeEach(async () => {
  await cleanDatabase();
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

/** Create a published paper with real files on disk */
async function createPaperWithFiles(
  userId: number,
  opts: { latex?: boolean } = {},
) {
  const paper = await createTestPaper(userId, { status: "published" });
  const paperDir = resolve(UPLOADS_DIR, paper.paperId);
  mkdirSync(paperDir, { recursive: true });
  writeFileSync(resolve(paperDir, "paper.pdf"), SYNTHETIC_PDF);

  if (opts.latex) {
    writeFileSync(resolve(paperDir, "paper.tex"), SYNTHETIC_TEX);
    await prisma.paper.update({
      where: { id: paper.id },
      data: { latexPath: `uploads/papers/${paper.paperId}/paper.tex` },
    });
  }

  return paper;
}

describe("paper download", () => {
  test("download PDF via CLI", async () => {
    const editor = await createTestUser({ githubLogin: "dl-ed", role: "editor" });
    const paper = await createPaperWithFiles(editor.id);
    const outputPath = resolve(TMP_DIR, "downloaded.pdf");

    const { data } = await runCliJson<{ paperId: string; format: string; bytes: number }>(
      "paper", "download", paper.paperId,
      "--output", outputPath, "--as", "dl-ed",
    );
    expect(data.format).toBe("pdf");
    expect(data.bytes).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });

  test("download LaTeX via CLI", async () => {
    const editor = await createTestUser({ githubLogin: "dl-tex-ed", role: "editor" });
    const paper = await createPaperWithFiles(editor.id, { latex: true });
    const outputPath = resolve(TMP_DIR, "downloaded.tex");

    const { data } = await runCliJson<{ paperId: string; format: string; bytes: number }>(
      "paper", "download", paper.paperId,
      "--file-type", "latex", "--output", outputPath, "--as", "dl-tex-ed",
    );
    expect(data.format).toBe("latex");
    expect(data.bytes).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("download LaTeX when none available → error", async () => {
    const editor = await createTestUser({ githubLogin: "dl-noltx-ed", role: "editor" });
    const paper = await createPaperWithFiles(editor.id); // no latex

    const { error } = await runCliError(
      "paper", "download", paper.paperId,
      "--file-type", "latex", "--as", "dl-noltx-ed",
    );
    expect(error).toBeTruthy();
  });

  test("authenticated download creates Download record", async () => {
    const user = await createTestUser({ githubLogin: "dl-user" });
    const paper = await createPaperWithFiles(user.id);
    const outputPath = resolve(TMP_DIR, "dl-record.pdf");

    await runCli(
      "paper", "download", paper.paperId,
      "--output", outputPath, "--as", "dl-user",
    );

    const downloads = await prisma.download.findMany({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(downloads.length).toBeGreaterThanOrEqual(1);
  });

  test("download nonexistent paper → error", async () => {
    const editor = await createTestUser({ githubLogin: "dl-404-ed", role: "editor" });

    const { error } = await runCliError(
      "paper", "download", "9999-999", "--as", "dl-404-ed",
    );
    expect(error).toContain("Paper not found");
  });
});
