/**
 * Paper Commands — Submit, browse, show, download
 *
 * submit reimplements the server action's FormData + getSession() flow:
 * - FormData → --title/--abstract/--category/--tags flags + --pdf file path
 * - getSession() → --as <login> resolved via resolveUser()
 * - revalidatePath() → skipped (no cache in CLI)
 *
 * The submission pipeline (validation → transaction → file storage)
 * is mirrored exactly, including the retry-on-P2002 loop for concurrent
 * paper ID generation.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import { prisma } from "@/lib/db";
import { nextPaperId } from "@/lib/paper-id";
import { storePaperFiles } from "@/lib/storage";
import { validatePaperSubmission } from "@/lib/validation/schemas";
import { slugToLabel } from "@/lib/tags";
import { MAX_PDF_SIZE, MAX_LATEX_SIZE } from "@/lib/constants";
import { EDITOR_ROLES } from "@/lib/paper-access";
import { CliError, output, resolveUser, withCliTrace } from "@/cli/helpers";

export function registerPaperCommands(program: Command): void {
  const paper = program.command("paper").description("Manage papers");

  // ── submit ──────────────────────────────────────────────
  paper
    .command("submit")
    .description("Submit a new paper")
    .requiredOption("--title <title>", "Paper title")
    .requiredOption("--abstract <abstract>", "Paper abstract")
    .requiredOption("--category <category>", "Category: research | expository")
    .requiredOption("--pdf <path>", "Path to PDF file")
    .option("--latex <path>", "Path to LaTeX source file")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (opts, cmd) => {
      await withCliTrace("cli.paper.submit", cmd, async (trace) => {
        const user = await resolveUser(cmd);
        trace.mark("auth");

        // Parse tags
        const tags = opts.tags
          ? opts.tags
              .split(",")
              .map((t: string) => t.trim().toLowerCase().replace(/\s+/g, "-"))
              .filter(Boolean)
          : [];

        // Validate text fields
        const validated = validatePaperSubmission({
          title: opts.title,
          abstract: opts.abstract,
          category: opts.category,
          tags,
        });
        if (validated.isErr()) {
          throw new CliError(validated.error);
        }
        trace.mark("validate");

        // Read and validate PDF
        if (!existsSync(opts.pdf)) {
          throw new CliError(`PDF file not found: ${opts.pdf}`);
        }
        const pdfBuffer = await trace.step("file-read", () => readFile(opts.pdf));
        if (pdfBuffer.length > MAX_PDF_SIZE) {
          throw new CliError("PDF must be under 50 MB", { size: pdfBuffer.length });
        }
        const magic = pdfBuffer.subarray(0, 5).toString("ascii");
        if (magic !== "%PDF-") {
          throw new CliError("File is not a valid PDF", { magic, path: opts.pdf });
        }

        // Read LaTeX (optional)
        let latexBuffer: Buffer | undefined;
        if (opts.latex) {
          if (!existsSync(opts.latex)) {
            throw new CliError(`LaTeX file not found: ${opts.latex}`);
          }
          latexBuffer = await trace.step("file-read", () => readFile(opts.latex));
          if (latexBuffer.length > MAX_LATEX_SIZE) {
            throw new CliError("LaTeX file must be under 5 MB", { size: latexBuffer.length });
          }
        }

        // Generate paper ID + create DB records in transaction (retry on P2002)
        const MAX_RETRIES = 3;
        let paperId: string | undefined;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            paperId = await trace.step("db-create", () =>
              prisma.$transaction(async (tx) => {
                const id = await nextPaperId(tx);
                const pdfPath = `uploads/papers/${id}/paper.pdf`;
                const lPath = latexBuffer ? `uploads/papers/${id}/paper.tex` : null;

                const p = await tx.paper.create({
                  data: {
                    paperId: id,
                    title: opts.title.trim(),
                    abstract: opts.abstract.trim(),
                    category: opts.category,
                    pdfPath,
                    latexPath: lPath,
                  },
                });

                await tx.paperAuthor.create({
                  data: { paperId: p.id, userId: user.id, order: 1 },
                });

                for (const slug of tags) {
                  const tag = await tx.tag.upsert({
                    where: { slug },
                    create: { slug, label: slugToLabel(slug) },
                    update: {},
                  });
                  await tx.paperTag.create({
                    data: { paperId: p.id, tagId: tag.id },
                  });
                }

                return id;
              }),
            );
            break;
          } catch (e: unknown) {
            const isPrismaUniqueViolation =
              e instanceof Error && "code" in e && (e as { code: string }).code === "P2002";
            if (isPrismaUniqueViolation && attempt < MAX_RETRIES - 1) continue;
            throw e;
          }
        }

        if (!paperId) {
          throw new CliError("Failed to generate paper ID");
        }

        // Store files to disk
        try {
          await trace.step("file-write", () =>
            storePaperFiles({
              paperId,
              pdf: pdfBuffer,
              latex: latexBuffer,
              metadata: {
                title: opts.title,
                abstract: opts.abstract,
                category: opts.category,
                tags,
                authors: [
                  {
                    name: user.displayName,
                    type: user.authorType,
                    github: user.githubLogin,
                    human: user.humanName,
                  },
                ],
                submitted: new Date().toISOString().split("T")[0],
              },
            }),
          );
        } catch (fileErr) {
          await prisma.paper.delete({ where: { paperId } }).catch(() => {});
          throw fileErr;
        }

        output({ paperId }, cmd);
      });
    });

  // ── list ────────────────────────────────────────────────
  paper
    .command("list")
    .description("List papers (non-editors see published only)")
    .option("--status <status>", "Filter by status (editors only)")
    .option("--category <category>", "Filter by category")
    .option("--page <n>", "Page number", "1")
    .action(async (opts, cmd) => {
      await withCliTrace("cli.paper.list", cmd, async (trace) => {
        const login = cmd.optsWithGlobals().as as string | undefined;
        let isEditor = false;

        if (login) {
          const user = await trace.step("db-query", () =>
            prisma.user.findUnique({
              where: { githubLogin: login },
              select: { role: true },
            }),
          );
          if (user && EDITOR_ROLES.includes(user.role)) isEditor = true;
        }
        trace.mark("auth");

        const page = parseInt(opts.page, 10);
        const limit = 20;
        const offset = (page - 1) * limit;

        // Build where clause
        const where: Record<string, unknown> = {};
        if (isEditor && opts.status) {
          where.status = opts.status;
        } else if (!isEditor) {
          where.status = "published";
        }
        if (opts.category) {
          where.category = opts.category;
        }

        const [papers, total] = await trace.step("db-query", () =>
          Promise.all([
            prisma.paper.findMany({
              where,
              select: {
                paperId: true,
                title: true,
                category: true,
                status: true,
                submittedAt: true,
                publishedAt: true,
              },
              orderBy: { submittedAt: "desc" },
              skip: offset,
              take: limit,
            }),
            prisma.paper.count({ where }),
          ]),
        );

        output({ papers, total, page, pages: Math.ceil(total / limit) }, cmd);
      });
    });

  // ── show ────────────────────────────────────────────────
  paper
    .command("show <paperId>")
    .description("Show paper detail (access-controlled)")
    .action(async (paperId, _opts, cmd) => {
      await withCliTrace("cli.paper.show", cmd, async (trace) => {
        const login = cmd.optsWithGlobals().as as string | undefined;
        let isEditor = false;

        if (login) {
          const user = await trace.step("db-query", () =>
            prisma.user.findUnique({
              where: { githubLogin: login },
              select: { role: true },
            }),
          );
          if (user && EDITOR_ROLES.includes(user.role)) isEditor = true;
        }
        trace.mark("auth");

        const where = isEditor
          ? { paperId }
          : { paperId, status: "published" as const };

        const found = await trace.step("db-query", () =>
          prisma.paper.findFirst({
            where,
            include: {
              authors: {
                include: { user: { select: { githubLogin: true, displayName: true, authorType: true } } },
                orderBy: { order: "asc" as const },
              },
              tags: { include: { tag: { select: { slug: true, label: true } } } },
              reviews: {
                where: isEditor ? {} : { visible: true },
                select: {
                  id: true,
                  noveltyScore: true,
                  correctnessScore: true,
                  clarityScore: true,
                  significanceScore: true,
                  priorWorkScore: true,
                  summary: true,
                  strengths: true,
                  weaknesses: true,
                  verdict: true,
                  visible: true,
                  reviewer: { select: { githubLogin: true, displayName: true } },
                },
              },
              notes: {
                include: {
                  user: { select: { githubLogin: true, displayName: true } },
                },
                orderBy: { createdAt: "asc" as const },
              },
              _count: { select: { downloads: true, favourites: true } },
            },
          }),
        );

        if (!found) {
          throw new CliError("Paper not found", { paperId });
        }

        output(found, cmd);
      });
    });

  // ── download ────────────────────────────────────────────
  paper
    .command("download <paperId>")
    .description("Download paper file to disk")
    .option("--file-type <fmt>", "File type: pdf | latex", "pdf")
    .option("--output <path>", "Output file path")
    .action(async (paperId, opts, cmd) => {
      await withCliTrace("cli.paper.download", cmd, async (trace) => {
        const login = cmd.optsWithGlobals().as as string | undefined;
        let isEditor = false;
        let userId: number | null = null;

        if (login) {
          const user = await trace.step("db-query", () =>
            prisma.user.findUnique({
              where: { githubLogin: login },
              select: { id: true, role: true },
            }),
          );
          if (user) {
            userId = user.id;
            if (EDITOR_ROLES.includes(user.role)) isEditor = true;
          }
        }
        trace.mark("auth");

        const where = isEditor
          ? { paperId }
          : { paperId, status: "published" as const };

        const paper = await trace.step("db-query", () =>
          prisma.paper.findFirst({
            where,
            select: { id: true, paperId: true, pdfPath: true, latexPath: true },
          }),
        );

        if (!paper) {
          throw new CliError("Paper not found", { paperId });
        }

        const filePath = opts.fileType === "latex" ? paper.latexPath : paper.pdfPath;
        if (!filePath) {
          throw new CliError(`No ${opts.fileType} file available for this paper`);
        }

        // Path traversal guard
        const { getAbsolutePdfPath } = await import("@/lib/storage");
        const absPath = getAbsolutePdfPath(filePath);
        if (!absPath.startsWith(process.cwd())) {
          throw new CliError("Invalid file path", { paperId, path: filePath });
        }

        // Read file and write to output path or stdout info
        const fileBuffer = await trace.step("file-read", () => readFile(absPath));
        const ext = opts.fileType === "latex" ? "tex" : "pdf";
        const outputPath = opts.output ?? `${paperId}.${ext}`;

        const { writeFile } = await import("node:fs/promises");
        await trace.step("file-write", () => writeFile(outputPath, fileBuffer));

        // Log download
        if (userId) {
          await trace.step("db-create", () =>
            prisma.download.create({
              data: { paperId: paper.id, userId },
            }),
          );
        }

        output({ paperId, format: opts.fileType, outputPath, bytes: fileBuffer.length }, cmd);
      });
    });
}
