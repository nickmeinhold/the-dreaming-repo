/**
 * GET /api/papers/[paperId]/download — Stream PDF (or LaTeX)
 *
 * Serves the paper's PDF from disk. Logs downloads for
 * authenticated users. Supports ?format=latex for source.
 */

import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getAbsolutePdfPath, UPLOADS_BASE } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> },
) {
  const { paperId } = await params;
  const format = request.nextUrl.searchParams.get("format");

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true, pdfPath: true, latexPath: true, title: true },
  });

  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  const isLatex = format === "latex";
  const filePath = isLatex ? paper.latexPath : paper.pdfPath;

  if (!filePath) {
    return NextResponse.json(
      { error: isLatex ? "LaTeX source not available" : "PDF not available" },
      { status: 404 },
    );
  }

  // Log download for authenticated users (fire-and-forget)
  const session = await getSession();
  if (session) {
    prisma.download
      .create({
        data: { paperId: paper.id, userId: session.userId },
      })
      .catch(() => {});
  }

  const absolutePath = getAbsolutePdfPath(filePath);

  // Guard against path traversal — resolved path must stay within uploads/
  if (!path.resolve(absolutePath).startsWith(path.resolve(UPLOADS_BASE))) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  try {
    const stat = statSync(absolutePath);
    const contentType = isLatex ? "application/x-tex" : "application/pdf";
    const ext = isLatex ? "tex" : "pdf";
    const filename = `${paperId}.${ext}`;
    const nodeStream = createReadStream(absolutePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(stat.size),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found on disk" },
      { status: 404 },
    );
  }
}
