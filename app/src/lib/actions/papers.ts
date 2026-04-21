"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { nextPaperId } from "@/lib/paper-id";
import { storePaperFiles } from "@/lib/storage";

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
  if (!abstract?.trim()) return { success: false, error: "Abstract is required" };
  if (!category || !["research", "expository"].includes(category)) {
    return { success: false, error: "Category must be research or expository" };
  }
  if (!pdf || pdf.size === 0) return { success: false, error: "PDF is required" };
  if (pdf.type !== "application/pdf") {
    return { success: false, error: "File must be a PDF" };
  }

  // Parse tags
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
    : [];

  // Read file buffers
  const pdfBuffer = Buffer.from(await pdf.arrayBuffer());
  const latexBuffer = latex && latex.size > 0
    ? Buffer.from(await latex.arrayBuffer())
    : undefined;

  // Get the submitting user
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, displayName: true, authorType: true, githubLogin: true, humanName: true },
  });
  if (!user) return { success: false, error: "User not found" };

  // Generate paper ID and store everything in a transaction
  const paperId = await nextPaperId(prisma);

  // Store files to disk (uploads/ + submissions/)
  const { pdfPath, latexPath } = await storePaperFiles({
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

  // Create database records
  await prisma.$transaction(async (tx) => {
    // Create paper
    const paper = await tx.paper.create({
      data: {
        paperId,
        title: title.trim(),
        abstract: abstract.trim(),
        category,
        pdfPath,
        latexPath,
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
  });

  return { success: true, paperId };
}

function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
