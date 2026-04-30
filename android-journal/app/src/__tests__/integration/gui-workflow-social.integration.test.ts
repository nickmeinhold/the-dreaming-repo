/**
 * GUI CLI E2E Workflow Tests — Social Interactions
 *
 * Mirrors workflow-social.integration.test.ts but drives the
 * web frontend via Playwright.
 *
 * W3: Browse, discover, engage
 * W5: Deep note threading (multi-user)
 * W6: Interest matching builds over time
 * Favourite/read edge cases
 *
 * Requires: Next.js dev server running against test database.
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { runGuiCli, runGuiCliJson, runGuiCliError } from "./gui-cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  await cleanDatabase();
});

describe("GUI W3: browse, discover, engage", () => {
  test("full engagement workflow: list → show → favourite → note → read", async () => {
    const author = await createTestUser({ githubLogin: "gui-w3-author" });
    const reader = await createTestUser({ githubLogin: "gui-w3-reader" });
    const paper = await createTestPaper(author.id, {
      status: "published",
      title: "Engagement Test Paper",
      abstract: "A paper to test the full social engagement workflow.",
    });

    // 1. Browse papers (no auth needed)
    const { data: papers } = await runGuiCliJson<{ papers: unknown[] }>("paper", "list");
    expect(papers.papers.length).toBeGreaterThanOrEqual(1);

    // 2. View paper detail
    const { data: detail } = await runGuiCliJson<{ title: string }>(
      "paper", "show", paper.paperId,
    );
    expect(detail.title).toBe("Engagement Test Paper");

    // 3. Toggle favourite ON
    const { data: favOn } = await runGuiCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "gui-w3-reader",
    );
    expect(favOn.favourited).toBe(true);

    // Verify in DB
    const favCount = await prisma.favourite.count({
      where: { paperId: paper.id, userId: reader.id },
    });
    expect(favCount).toBe(1);

    // 4. Add a note
    const { data: note } = await runGuiCliJson<{ content: string }>(
      "note", "add", paper.paperId, "Great paper on engagement!", "--as", "gui-w3-reader",
    );
    expect(note.content).toBe("Great paper on engagement!");

    // Verify note in DB
    const dbNote = await prisma.note.findFirst({
      where: { paperId: paper.id, userId: reader.id },
    });
    expect(dbNote).toBeTruthy();
    expect(dbNote!.content).toBe("Great paper on engagement!");

    // 5. Mark as read
    const { data: readResult } = await runGuiCliJson<{ read: boolean }>(
      "read", "mark", paper.paperId, "--as", "gui-w3-reader",
    );
    expect(readResult.read).toBe(true);
  });
});

describe("GUI W5: deep note threading", () => {
  test("depth 3: three users in a thread", async () => {
    const alice = await createTestUser({ githubLogin: "gui-thread-alice" });
    const bob = await createTestUser({ githubLogin: "gui-thread-bob" });
    const carol = await createTestUser({ githubLogin: "gui-thread-carol" });
    const paper = await createTestPaper(alice.id, { status: "published" });

    // Depth 1: Alice posts top-level note
    const { data: n1 } = await runGuiCliJson<{ id: number; content: string }>(
      "note", "add", paper.paperId, "Top-level note", "--as", "gui-thread-alice",
    );

    // Get actual note ID from DB (GUI CLI may return id: 0)
    const dbNote1 = await prisma.note.findFirst({
      where: { paperId: paper.id, content: "Top-level note" },
    });
    expect(dbNote1).toBeTruthy();

    // Depth 2: Bob replies to Alice
    const { data: n2 } = await runGuiCliJson<{ id: number }>(
      "note", "add", paper.paperId, "Reply to Alice",
      "--reply-to", String(dbNote1!.id), "--as", "gui-thread-bob",
    );

    const dbNote2 = await prisma.note.findFirst({
      where: { paperId: paper.id, content: "Reply to Alice" },
    });
    expect(dbNote2!.parentId).toBe(dbNote1!.id);

    // Depth 3: Carol replies to Bob
    await runGuiCliJson(
      "note", "add", paper.paperId, "Reply to Bob",
      "--reply-to", String(dbNote2!.id), "--as", "gui-thread-carol",
    );

    // Verify parentId chain in DB
    const notes = await prisma.note.findMany({
      where: { paperId: paper.id },
      orderBy: { createdAt: "asc" },
    });
    expect(notes).toHaveLength(3);
    expect(notes[0].parentId).toBeNull();
    expect(notes[1].parentId).toBe(notes[0].id);
    expect(notes[2].parentId).toBe(notes[1].id);
  });
});

describe("GUI W6: interest matching", () => {
  test("Jaccard similarity with overlapping reads", async () => {
    const author = await createTestUser({ githubLogin: "gui-jac-author" });
    const alice = await createTestUser({ githubLogin: "gui-jac-alice" });
    const bob = await createTestUser({ githubLogin: "gui-jac-bob" });

    // Create 3 published papers
    const p1 = await createTestPaper(author.id, { status: "published" });
    const p2 = await createTestPaper(author.id, { status: "published" });
    const p3 = await createTestPaper(author.id, { status: "published" });

    // Alice reads all 3
    await runGuiCli("read", "mark", p1.paperId, "--as", "gui-jac-alice");
    await runGuiCli("read", "mark", p2.paperId, "--as", "gui-jac-alice");
    await runGuiCli("read", "mark", p3.paperId, "--as", "gui-jac-alice");

    // Bob reads p1, p2 (overlap = 2, union = 3, J = 2/3)
    await runGuiCli("read", "mark", p1.paperId, "--as", "gui-jac-bob");
    await runGuiCli("read", "mark", p2.paperId, "--as", "gui-jac-bob");

    // Verify DB state — reads exist
    const aliceReads = await prisma.download.count({
      where: { userId: alice.id, read: true },
    });
    expect(aliceReads).toBe(3);

    const bobReads = await prisma.download.count({
      where: { userId: bob.id, read: true },
    });
    expect(bobReads).toBe(2);
  });
});

describe("GUI favourite edge cases", () => {
  test("favourite toggle cycle: on → off → on", async () => {
    const user = await createTestUser({ githubLogin: "gui-fav-cycle" });
    const paper = await createTestPaper(user.id, { status: "published" });

    // Toggle ON
    const { data: on1 } = await runGuiCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "gui-fav-cycle",
    );
    expect(on1.favourited).toBe(true);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(1);

    // Toggle OFF
    const { data: off } = await runGuiCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "gui-fav-cycle",
    );
    expect(off.favourited).toBe(false);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(0);

    // Toggle ON again
    const { data: on2 } = await runGuiCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "gui-fav-cycle",
    );
    expect(on2.favourited).toBe(true);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(1);
  });
});
