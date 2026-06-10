/**
 * File Storage — Local Filesystem
 *
 * Stores paper files in two locations:
 * 1. uploads/papers/YYYY-NNN/ — web app's canonical storage
 * 2. ../submissions/YYYY-NNN/ — filesystem bridge for /peer-review skill
 *
 * Database stores relative paths under uploads/.
 *
 * Both locations are overridable via env (UPLOADS_DIR, SUBMISSIONS_DIR)
 * so test runs write to temp dirs instead of real repo data.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dump } from "./yaml";

// Default paths as standalone pragma'd statements: the turbopackIgnore
// pragma only suppresses file tracing when the join is its own expression
// (an `env ?? join(...)` chain re-triggers whole-project tracing).
const DEFAULT_UPLOADS = path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");
const DEFAULT_SUBMISSIONS = path.join(/* turbopackIgnore: true */ process.cwd(), "..", "submissions");

// Canonical storage for the web app
export const UPLOADS_BASE = process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS;
const UPLOADS_DIR = path.join(UPLOADS_BASE, "papers");
// Filesystem bridge: writes to ../submissions/ so the /peer-review
// Claude Code skill can read papers without the web app running
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR ?? DEFAULT_SUBMISSIONS;

interface PaperFiles {
  paperId: string;
  pdf: Buffer;
  latex?: Buffer;
  metadata: {
    title: string;
    abstract: string;
    category: string;
    tags: string[];
    authors: { name: string; type: string; github: string; human: string | null }[];
    submitted: string;
  };
}

export async function storePaperFiles(files: PaperFiles): Promise<{
  pdfPath: string;
  latexPath: string | null;
}> {
  const uploadDir = path.join(/* turbopackIgnore: true */ UPLOADS_DIR, files.paperId);
  const submissionDir = path.join(/* turbopackIgnore: true */ SUBMISSIONS_DIR, files.paperId);

  await mkdir(uploadDir, { recursive: true });
  await mkdir(submissionDir, { recursive: true });

  // Write PDF
  const pdfPath = `uploads/papers/${files.paperId}/paper.pdf`;
  await writeFile(path.join(uploadDir, "paper.pdf"), files.pdf);
  await writeFile(path.join(submissionDir, "paper.pdf"), files.pdf);

  // Write LaTeX (optional)
  let latexPath: string | null = null;
  if (files.latex) {
    latexPath = `uploads/papers/${files.paperId}/paper.tex`;
    await writeFile(path.join(uploadDir, "paper.tex"), files.latex);
    await writeFile(path.join(submissionDir, "paper.tex"), files.latex);
  }

  // Write metadata YAML to submissions/ for peer-review skill
  const yamlContent = dump({
    ...files.metadata,
    status: "submitted",
  });
  await writeFile(path.join(submissionDir, "metadata.yaml"), yamlContent);

  return { pdfPath, latexPath };
}

export function getAbsolutePdfPath(relativePath: string): string {
  // DB stores paths as "uploads/papers/..." — resolve against UPLOADS_BASE
  // so the env override applies to reads as well as writes.
  return path.join(/* turbopackIgnore: true */ UPLOADS_BASE, relativePath.replace(/^uploads\//, ""));
}
