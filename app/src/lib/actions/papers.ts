"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { nextPaperId } from "@/lib/paper-id";
import { storePaperFiles } from "@/lib/storage";
import { MAX_PDF_SIZE, MAX_LATEX_SIZE, VALID_CATEGORIES } from "@/lib/constants";

export interface SubmitPaperResult {
  success: boolean;
  paperId?: string;
  error?: string;
}

export async function submitPaper(
  formData: FormData,
): Promise<SubmitPaperResult> {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Authentication required" };
  }

  // Extract fields
  const title = formData.get("title") as string;
  const abstract = formData.get("abstract") as string;
  const category = formData.get("category") as string;
  const tagsRaw = formData.get("tags") as string;
  const pdf = formData.get("pdf") as File | null;
  const latex = formData.get("latex") as File | null;

  // Validate
  if (!title?.trim()) return { success: false, error: "Title is required" };
  if (title.length > 500) return { success: false, error: "Title must be under 500 characters" };
  if (!abstract?.trim()) return { success: false, error: "Abstract is required" };
  if (abstract.length > 10_000) return { success: false, error: "Abstract must be under 10,000 characters" };
  if (!category || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
    return { success: false, error: "Category must be research or expository" };
  }
  if (!pdf || pdf.size === 0) return { success: false, error: "PDF is required" };
  if (pdf.size > MAX_PDF_SIZE) {
    return { success: false, error: "PDF must be under 50 MB" };
  }

  // Read buffer and validate magic bytes (%PDF-)
  const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
  const magic = pdfBuffer.subarray(0, 5).toString("ascii");
  if (magic !== "%PDF-") {
    return { success: false, error: "File is not a valid PDF" };
  }

  // Parse tags
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
    : [];

  if (latex && latex.size > MAX_LATEX_SIZE) {
    return { success: false, error: "LaTeX file must be under 10 MB" };
  }
  const latexBuffer = latex && latex.size > 0
    ? Buffer.from(await latex.arrayBuffer())
    : undefined;

  // Get the submitting user
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, displayName: true, authorType: true, githubLogin: true, humanName: true },
  });
  if (!user) return { success: false, error: "User not found" };

  // Generate paper ID inside the transaction to prevent race conditions
  const paperId = await prisma.$transaction(async (tx) => {
    const id = await nextPaperId(tx);

    const paper = await tx.paper.create({
      data: {
        paperId: id,
        title: title.trim(),
        abstract: abstract.trim(),
        category,
      },
    });

    // Link submitting user as author
    await tx.paperAuthor.create({
      data: {
        paperId: paper.id,
        userId: user.id,
        order: 1,
      },
    });

    // Create or find tags, then link
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

  // Store files to disk after successful DB transaction
  let pdfPath: string;
  let latexPath: string | undefined;
  try {
    const stored = await storePaperFiles({
      paperId,
      pdf: pdfBuffer,
      latex: latexBuffer,
      metadata: {
        title,
        abstract,
        category,
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
    });
    pdfPath = stored.pdfPath;
    latexPath = stored.latexPath;
  } catch {
    // File storage failed — clean up the orphan DB record
    await prisma.paper.delete({ where: { paperId } }).catch(() => {});
    return { success: false, error: "Failed to store paper files" };
  }

  // Update paper with file paths
  await prisma.paper.update({
    where: { paperId },
    data: { pdfPath, latexPath },
  });

  return { success: true, paperId };
}

function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
