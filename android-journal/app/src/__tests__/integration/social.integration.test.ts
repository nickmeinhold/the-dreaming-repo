/**
 * Integration Tests — Social Layer
 *
 * Tests notes (threading, access control), favourites (toggle, uniqueness),
 * and read marking — all against a real PostgreSQL database.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { addNote, toggleFavourite, markAsRead } from "@/lib/actions/social";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
});

describe("Notes", () => {
  test("adds a top-level note on a published paper", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await addNote(paper.paperId, "Great paper!");
    expect(result.success).toBe(true);

    const notes = await prisma.note.findMany({
      where: { paperId: paper.id },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("Great paper!");
    expect(notes[0].parentId).toBeNull();
    expect(notes[0].userId).toBe(user.id);
  });

  test("adds a threaded reply", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await addNote(paper.paperId, "Parent note");
    const parent = await prisma.note.findFirst({
      where: { paperId: paper.id },
    });

    const result = await addNote(paper.paperId, "Reply", parent!.id);
    expect(result.success).toBe(true);

    const reply = await prisma.note.findFirst({
      where: { parentId: parent!.id },
    });
    expect(reply).toBeTruthy();
    expect(reply!.content).toBe("Reply");
  });

  test("rejects cross-paper reply", async () => {
    const user = await createTestUser();
    const paper1 = await createTestPaper(user.id, { status: "published" });
    const paper2 = await createTestPaper(user.id, {
      status: "published",
      paperId: "2026-099",
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    await addNote(paper1.paperId, "Note on paper 1");
    const noteOnPaper1 = await prisma.note.findFirst({
      where: { paperId: paper1.id },
    });

    // Try to reply on paper2 with a parent from paper1
    const result = await addNote(
      paper2.paperId,
      "Cross-paper attack",
      noteOnPaper1!.id,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid parent note");
  });

  test("rejects note on unpublished paper for non-editor", async () => {
    const author = await createTestUser();
    const commenter = await createTestUser();
    const paper = await createTestPaper(author.id); // status = submitted

    vi.mocked(getSession).mockResolvedValue({
      userId: commenter.id,
      githubLogin: commenter.githubLogin,
      role: "user",
    });

    const result = await addNote(paper.paperId, "Shouldn't work");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found"); // Doesn't leak existence
  });

  test("rejects unauthenticated note", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await addNote("2026-001", "Anonymous note");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication required");
  });

  test("rejects empty note content", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await addNote(paper.paperId, "");
    expect(result.success).toBe(false);
  });
});

describe("Favourites", () => {
  test("toggle on then off", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    // Toggle on
    const on = await toggleFavourite(paper.paperId);
    expect(on.success).toBe(true);
    expect(on.favourited).toBe(true);

    const favs = await prisma.favourite.findMany({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(favs).toHaveLength(1);

    // Toggle off
    const off = await toggleFavourite(paper.paperId);
    expect(off.success).toBe(true);
    expect(off.favourited).toBe(false);

    const none = await prisma.favourite.findMany({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(none).toHaveLength(0);
  });

  test("rejects favourite on unpublished paper for non-editor", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id); // submitted

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await toggleFavourite(paper.paperId);
    expect(result.success).toBe(false);
  });
});

describe("Read Marking", () => {
  test("marks existing download as read", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    // Create a prior download record
    await prisma.download.create({
      data: { paperId: paper.id, userId: user.id, read: false },
    });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await markAsRead(paper.paperId);
    expect(result.success).toBe(true);

    const download = await prisma.download.findFirst({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(download!.read).toBe(true);
  });

  test("creates download record if none exists", async () => {
    const user = await createTestUser();
    const paper = await createTestPaper(user.id, { status: "published" });

    vi.mocked(getSession).mockResolvedValue({
      userId: user.id,
      githubLogin: user.githubLogin,
      role: "user",
    });

    const result = await markAsRead(paper.paperId);
    expect(result.success).toBe(true);

    const download = await prisma.download.findFirst({
      where: { paperId: paper.id, userId: user.id },
    });
    expect(download).toBeTruthy();
    expect(download!.read).toBe(true);
  });
});
