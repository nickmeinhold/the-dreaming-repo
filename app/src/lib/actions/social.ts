"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

// ── Notes ──────────────────────────────────────────────────

export async function addNote(
  paperId: string,
  content: string,
  parentId?: number,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { success: false, error: "Authentication required" };
  if (!content.trim()) return { success: false, error: "Content is required" };
  if (content.length > 50_000) return { success: false, error: "Note must be under 50,000 characters" };

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true },
  });
  if (!paper) return { success: false, error: "Paper not found" };

  if (parentId) {
    const parent = await prisma.note.findUnique({
      where: { id: parentId },
      select: { paperId: true },
    });
    if (!parent || parent.paperId !== paper.id) {
      return { success: false, error: "Invalid parent note" };
    }
  }

  await prisma.note.create({
    data: {
      content: content.trim(),
      paperId: paper.id,
      userId: session.userId,
      parentId: parentId ?? null,
    },
  });

  revalidatePath(`/papers/${paperId}`, "page");
  return { success: true };
}

// ── Favourites ─────────────────────────────────────────────

export async function toggleFavourite(
  paperId: string,
): Promise<{ success: boolean; favourited: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { success: false, favourited: false, error: "Authentication required" };

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true },
  });
  if (!paper) return { success: false, favourited: false, error: "Paper not found" };

  // Use deleteMany to atomically check-and-delete (avoids TOCTOU race)
  const { count } = await prisma.favourite.deleteMany({
    where: { paperId: paper.id, userId: session.userId },
  });

  if (count > 0) {
    return { success: true, favourited: false };
  }

  // No existing favourite — create one. Unique constraint prevents duplicates
  // from concurrent double-clicks.
  try {
    await prisma.favourite.create({
      data: { paperId: paper.id, userId: session.userId },
    });
    return { success: true, favourited: true };
  } catch (e: unknown) {
    // Prisma unique constraint violation (P2002) from concurrent request
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
      return { success: true, favourited: true };
    }
    return { success: false, favourited: false, error: "Failed to favourite paper" };
  }
}

// ── Read Marking ───────────────────────────────────────────

export async function markAsRead(
  paperId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { success: false, error: "Authentication required" };

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true },
  });
  if (!paper) return { success: false, error: "Paper not found" };

  // Find most recent download by this user for this paper
  const download = await prisma.download.findFirst({
    where: { paperId: paper.id, userId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  if (!download) {
    return { success: false, error: "You must download a paper before marking it as read" };
  }

  await prisma.download.update({
    where: { id: download.id },
    data: { read: true },
  });

  return { success: true };
}
