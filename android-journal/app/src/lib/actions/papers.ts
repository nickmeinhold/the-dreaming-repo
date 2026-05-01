"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { nextPaperId } from "@/lib/paper-id";
import { storePaperFiles } from "@/lib/storage";
import { MAX_PDF_SIZE, MAX_LATEX_SIZE } from "@/lib/constants";
import { ok, err, toActionResult } from "@/lib/result";
import { validatePaperSubmission } from "@/lib/validation/schemas";
import { slugToLabel } from "@/lib/tags";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { withActionTrace } from "@/lib/trace";

export interface SubmitPaperResult {
  success: boolean;
  paperId?: string;
  error?: string;
}

export async function submitPaper(
  formData: FormData,
): Promise<SubmitPaperResult> {
  return withActionTrace("paper.submit", async (trace) => {
    const session = await getSession();
    if (!session) { trace.fail("auth", "unauthenticated"); return toActionResult(err("Authentication required")); }
    trace.mark("auth");

    // Extract fields
    const title = formData.get("title") as string;
    const abstract = formData.get("abstract") as string;
    const category = formData.get("category") as string;
    const tagsRaw = formData.get("tags") as string;
    const pdf = formData.get("pdf") as File | null;
    const latex = formData.get("latex") as File | null;

    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
          .filter(Boolean)
      : [];
    trace.mark("extract-fields");

    // Validate text fields (accumulates all errors)
    const validated = validatePaperSubmission({ title, abstract, category, tags });
    if (validated.isErr()) {
      trace.fail("validate", validated.error);
      logAuditEvent({
        action: "validation.failed",
        entity: "paper",
        entityId: "submission",
        details: JSON.stringify({ errors: validated.error }),
      });
      return toActionResult(validated);
    }
    trace.mark("validate");

    // Validate PDF
    if (!pdf || pdf.size === 0) { trace.fail("pdf-check", "missing"); return toActionResult(err("PDF is required")); }
    if (pdf.size > MAX_PDF_SIZE) { trace.fail("pdf-check", "oversized"); return toActionResult(err("PDF must be under 50 MB")); }

    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
    const magic = pdfBuffer.subarray(0, 5).toString("ascii");
    if (magic !== "%PDF-") { trace.fail("pdf-magic", "invalid magic bytes"); return toActionResult(err("File is not a valid PDF")); }
    trace.mark("pdf-validate");

    if (latex && latex.size > MAX_LATEX_SIZE) { trace.fail("latex-check", "oversized"); return toActionResult(err("LaTeX file must be under 5 MB")); }
    const latexBuffer = latex && latex.size > 0
      ? Buffer.from(await latex.arrayBuffer())
      : undefined;
    trace.mark("latex-check");

    // Get the submitting user
    const user = await trace.step("user-lookup", () =>
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, displayName: true, authorType: true, githubLogin: true, humanName: true },
      }),
    );
    if (!user) { trace.fail("user-lookup", "not found"); return toActionResult(err("User not found")); }

    // Generate paper ID and create DB records in transaction (retry on P2002)
    const MAX_RETRIES = 3;
    let paperId: string | undefined;
    paperId = await trace.step("db-create", async () => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            const id = await nextPaperId(tx);
            const pdfPath = `uploads/papers/${id}/paper.pdf`;
            const lPath = latexBuffer ? `uploads/papers/${id}/paper.tex` : null;

            const paper = await tx.paper.create({
              data: { paperId: id, title: title.trim(), abstract: abstract.trim(), category, pdfPath, latexPath: lPath },
            });

            await tx.paperAuthor.create({
              data: { paperId: paper.id, userId: user.id, order: 1 },
            });

            for (const slug of tags) {
              const tag = await tx.tag.upsert({
                where: { slug },
                create: { slug, label: slugToLabel(slug) },
                update: {},
              });
              await tx.paperTag.create({
                data: { paperId: paper.id, tagId: tag.id },
              });
            }

            return id;
          });
        } catch (e: unknown) {
          const isPrismaUniqueViolation =
            e instanceof Error && "code" in e && (e as { code: string }).code === "P2002";
          if (isPrismaUniqueViolation && attempt < MAX_RETRIES - 1) continue;
          throw e;
        }
      }
      throw new Error("Failed to generate paper ID");
    });

    // Store files to disk. On failure, delete paper record for consistency.
    await trace.step("file-store", async () => {
      try {
        await storePaperFiles({
          paperId: paperId!,
          pdf: pdfBuffer,
          latex: latexBuffer,
          metadata: {
            title, abstract, category, tags,
            authors: [{
              name: user.displayName, type: user.authorType,
              github: user.githubLogin, human: user.humanName,
            }],
            submitted: new Date().toISOString().split("T")[0],
          },
        });
      } catch (fileErr) {
        await prisma.paper.delete({ where: { paperId } }).catch((deleteErr) => {
          logger.error({ err: deleteErr, paperId }, "compensating delete failed — zombie paper record may exist");
        });
        throw fileErr;
      }
    });

    await logAuditEvent({
      action: "paper.submitted",
      entity: "paper",
      entityId: paperId!,
      details: JSON.stringify({ title, category, tags }),
    });
    trace.mark("audit");

    return toActionResult(ok({ paperId }));
  });
}
