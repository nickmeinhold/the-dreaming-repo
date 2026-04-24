/**
 * GET /api/papers/[paperId]/download — Stream PDF (or LaTeX)
 *
 * Serves the paper's PDF from disk. Logs downloads for
 * authenticated users. Supports ?format=latex for source.
 */

import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { findVisiblePaper } from "@/lib/paper-access";
import { getAbsolutePdfPath, UPLOADS_BASE } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> },
) {
  return withActionTrace("paper.download", async (trace) => {
    const { paperId } = await params;
    const format = request.nextUrl.searchParams.get("format");

    const session = await getSession();
    trace.mark("auth");

    const paper = await trace.step("paper-lookup", () =>
      findVisiblePaper<{
        id: number; pdfPath: string | null; latexPath: string | null; title: string;
      }>(paperId, session, {
        select: { id: true, pdfPath: true, latexPath: true, title: true },
      }),
    );

    if (!paper) {
      trace.fail("paper-lookup", "not found or not visible");
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    const isLatex = format === "latex";
    const filePath = isLatex ? paper.latexPath : paper.pdfPath;

    if (!filePath) {
      trace.fail("path-resolve", isLatex ? "no latex" : "no pdf");
      return NextResponse.json(
        { error: isLatex ? "LaTeX source not available" : "PDF not available" },
        { status: 404 },
      );
    }
    trace.mark("path-resolve");

    const absolutePath = getAbsolutePdfPath(filePath);

    // Guard against path traversal
    if (!path.resolve(absolutePath).startsWith(path.resolve(UPLOADS_BASE))) {
      trace.fail("path-guard", "traversal attempt");
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }
    trace.mark("path-guard");

    // Log download for authenticated users (fire-and-forget)
    if (session) {
      prisma.download
        .create({ data: { paperId: paper.id, userId: session.userId } })
        .catch((err) => logger.warn({ err, paperId }, "Failed to log download"));
    }

    logAuditEvent({
      action: "paper.downloaded",
      entity: "paper",
      entityId: paperId,
      userId: session?.userId ?? null,
    });
    trace.mark("download-log");

    try {
      const fileStat = await stat(absolutePath);
      trace.mark("file-stat");

      const contentType = isLatex ? "application/x-tex" : "application/pdf";
      const ext = isLatex ? "tex" : "pdf";
      const filename = `${paperId}.${ext}`;
      const nodeStream = createReadStream(absolutePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new NextResponse(webStream, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Content-Length": String(fileStat.size),
        },
      });
    } catch {
      trace.fail("file-stat", "file not on disk");
      return NextResponse.json(
        { error: "File not found on disk" },
        { status: 404 },
      );
    }
  });
}
