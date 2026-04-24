/**
 * Paper Access Control — Visibility Helper
 *
 * Centralizes the logic for whether a paper is visible to a given user.
 * Non-editors can only see published papers. Editors and admins can see all.
 * Error messages never leak whether an unpublished paper exists.
 */

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

export const EDITOR_ROLES = ["editor", "admin"];

/**
 * Find a paper that the given user is allowed to see.
 * Returns null if the paper doesn't exist OR if the user lacks access.
 */
export async function findVisiblePaper<T>(
  paperId: string,
  session: SessionPayload | null,
  options: { select: Record<string, unknown> },
): Promise<T | null> {
  const isEditor = session && EDITOR_ROLES.includes(session.role);

  const where = isEditor
    ? { paperId }
    : { paperId, status: "published" };

  return prisma.paper.findFirst({
    where,
    select: options.select,
  }) as Promise<T | null>;
}
