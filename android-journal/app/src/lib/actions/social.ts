"use server";

import { prisma } from "@/lib/db";
import { getSession, type SessionPayload } from "@/lib/auth";
import { findVisiblePaper } from "@/lib/paper-access";
import { ok, err, toActionResult, type Result } from "@/lib/result";
import { validateNoteContent } from "@/lib/validation/schemas";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit";
import { withActionTrace } from "@/lib/trace";

async function requireAuth(): Promise<Result<SessionPayload>> {
  const session = await getSession();
  return session ? ok(session) : err("Authentication required");
}

async function requirePaper(
  paperId: string,
  session: SessionPayload,
): Promise<Result<{ id: number }>> {
  const paper = await findVisiblePaper<{ id: number }>(
    paperId, session, { select: { id: true } },
  );
  return paper ? ok(paper) : err("Paper not found");
}

// ── Notes ──────────────────────────────────────────────────

export async function addNote(
  paperId: string,
  content: string,
  parentId?: number,
): Promise<{ success: boolean; error?: string }> {
  return withActionTrace("note.add", async (trace) => {
    const auth = await requireAuth();
    if (auth.isErr()) { trace.fail("auth", auth.error); return toActionResult(auth); }
    trace.mark("auth");
    const session = auth.value;

    const contentResult = validateNoteContent(content);
    if (contentResult.isErr()) {
      trace.fail("validate", contentResult.error);
      logAuditEvent({
        action: "validation.failed",
        entity: "note",
        entityId: paperId,
        details: JSON.stringify({ errors: contentResult.error }),
      });
      return toActionResult(contentResult);
    }
    trace.mark("validate");

    const paperResult = await trace.step("paper-lookup", () => requirePaper(paperId, session));
    if (paperResult.isErr()) { trace.fail("paper-lookup", paperResult.error); return toActionResult(paperResult); }
    const paper = paperResult.value;

    if (parentId) {
      const parent = await trace.step("parent-check", () =>
        prisma.note.findUnique({ where: { id: parentId }, select: { paperId: true } }),
      );
      if (!parent || parent.paperId !== paper.id) {
        trace.fail("parent-check", "invalid parent note");
        return toActionResult(err("Invalid parent note"));
      }
    } else {
      trace.mark("parent-check");
    }

    await trace.step("db-create", () =>
      prisma.note.create({
        data: {
          content: content.trim(),
          paperId: paper.id,
          userId: session.userId,
          parentId: parentId ?? null,
        },
      }),
    );

    await logAuditEvent({
      action: "note.added",
      entity: "note",
      entityId: paperId,
      details: parentId ? JSON.stringify({ parentId }) : undefined,
    });
    trace.mark("audit");

    revalidatePath(`/papers/${paperId}`, "page");
    return toActionResult(ok({}));
  });
}

// ── Favourites ─────────────────────────────────────────────

export async function toggleFavourite(
  paperId: string,
): Promise<{ success: boolean; favourited: boolean; error?: string }> {
  return withActionTrace("favourite.toggle", async (trace) => {
    const auth = await requireAuth();
    if (auth.isErr()) { trace.fail("auth", auth.error); return { success: false, favourited: false, error: auth.error }; }
    trace.mark("auth");

    const session = auth.value;
    const paperResult = await trace.step("paper-lookup", () => requirePaper(paperId, session));
    if (paperResult.isErr()) { trace.fail("paper-lookup", paperResult.error); return { success: false, favourited: false, error: paperResult.error }; }
    const paper = paperResult.value;

    return trace.step("db-toggle", async () => {
      const { count } = await prisma.favourite.deleteMany({
        where: { paperId: paper.id, userId: session.userId },
      });

      if (count > 0) {
        return { success: true, favourited: false };
      }

      try {
        await prisma.favourite.create({
          data: { paperId: paper.id, userId: session.userId },
        });
        return { success: true, favourited: true };
      } catch (e: unknown) {
        if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
          return { success: true, favourited: true };
        }
        return { success: false, favourited: false, error: "Failed to favourite paper" };
      }
    });
  });
}

// ── Read Marking ───────────────────────────────────────────

export async function markAsRead(
  paperId: string,
): Promise<{ success: boolean; error?: string }> {
  return withActionTrace("read.mark", async (trace) => {
    const auth = await requireAuth();
    if (auth.isErr()) { trace.fail("auth", auth.error); return toActionResult(auth); }
    trace.mark("auth");

    const session = auth.value;
    const paperResult = await trace.step("paper-lookup", () => requirePaper(paperId, session));
    if (paperResult.isErr()) { trace.fail("paper-lookup", paperResult.error); return toActionResult(paperResult); }
    const paper = paperResult.value;

    await trace.step("db-upsert", async () => {
      const download = await prisma.download.findFirst({
        where: { paperId: paper.id, userId: session.userId },
        orderBy: { createdAt: "desc" },
      });

      if (download) {
        await prisma.download.update({
          where: { id: download.id },
          data: { read: true },
        });
      } else {
        await prisma.download.create({
          data: { paperId: paper.id, userId: session.userId, read: true },
        });
      }
    });

    return toActionResult(ok({}));
  });
}
