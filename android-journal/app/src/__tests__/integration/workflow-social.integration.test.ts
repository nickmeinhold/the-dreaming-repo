/**
 * CLI E2E Workflow Tests — Social Interactions
 *
 * Deep note threading, interest matching, favourite edge cases.
 *
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { runCli, runCliJson, runCliError } from "./cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  await cleanDatabase();
});

describe("deep note threading", () => {
  test("depth 3: three users in a thread", async () => {
    const alice = await createTestUser({ githubLogin: "thread-alice" });
    const bob = await createTestUser({ githubLogin: "thread-bob" });
    const carol = await createTestUser({ githubLogin: "thread-carol" });
    const paper = await createTestPaper(alice.id, { status: "published" });

    // Depth 1: Alice
    const { data: n1 } = await runCliJson<{ id: number }>(
      "note", "add", paper.paperId, "Top-level note", "--as", "thread-alice",
    );

    // Depth 2: Bob replies to Alice
    const { data: n2 } = await runCliJson<{ id: number }>(
      "note", "add", paper.paperId, "Reply to Alice",
      "--reply-to", String(n1.id), "--as", "thread-bob",
    );

    // Depth 3: Carol replies to Bob
    const { data: n3 } = await runCliJson<{ id: number }>(
      "note", "add", paper.paperId, "Reply to Bob",
      "--reply-to", String(n2.id), "--as", "thread-carol",
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

  test("depth 4: four-level thread chain", async () => {
    const users = await Promise.all(
      ["d4-a", "d4-b", "d4-c", "d4-d"].map((login) => createTestUser({ githubLogin: login })),
    );
    const paper = await createTestPaper(users[0].id, { status: "published" });

    // Build chain: each user replies to the previous
    let parentId: number | undefined;
    for (let i = 0; i < 4; i++) {
      const args: string[] = ["note", "add", paper.paperId, `Depth ${i + 1} note`];
      if (parentId) args.push("--reply-to", String(parentId));
      args.push("--as", users[i].githubLogin);
      const { data } = await runCliJson<{ id: number }>(...args);
      parentId = data.id;
    }

    const notes = await prisma.note.findMany({
      where: { paperId: paper.id },
      orderBy: { createdAt: "asc" },
    });
    expect(notes).toHaveLength(4);
    // Verify chain
    expect(notes[0].parentId).toBeNull();
    for (let i = 1; i < 4; i++) {
      expect(notes[i].parentId).toBe(notes[i - 1].id);
    }
  });
});

describe("interest matching", () => {
  test("Jaccard similarity with 3 users and overlapping reads", async () => {
    const author = await createTestUser({ githubLogin: "jac-author" });
    const alice = await createTestUser({ githubLogin: "jac-alice" });
    const bob = await createTestUser({ githubLogin: "jac-bob" });
    const carol = await createTestUser({ githubLogin: "jac-carol" });

    // Create 3 published papers
    const p1 = await createTestPaper(author.id, { status: "published" });
    const p2 = await createTestPaper(author.id, { status: "published" });
    const p3 = await createTestPaper(author.id, { status: "published" });

    // Alice reads all 3
    await runCli("read", "mark", p1.paperId, "--as", "jac-alice");
    await runCli("read", "mark", p2.paperId, "--as", "jac-alice");
    await runCli("read", "mark", p3.paperId, "--as", "jac-alice");

    // Bob reads p1, p2 (overlap = 2, union = 3, J = 2/3)
    await runCli("read", "mark", p1.paperId, "--as", "jac-bob");
    await runCli("read", "mark", p2.paperId, "--as", "jac-bob");

    // Carol reads p2, p3 (overlap = 2, union = 3, J = 2/3)
    await runCli("read", "mark", p2.paperId, "--as", "jac-carol");
    await runCli("read", "mark", p3.paperId, "--as", "jac-carol");

    const { data } = await runCliJson<{ githubLogin: string }[]>(
      "user", "similar", "jac-alice",
    );
    expect(data.length).toBe(2);
    // Both Bob and Carol have same Jaccard with Alice (2/3)
    const logins = data.map((u) => u.githubLogin);
    expect(logins).toContain("jac-bob");
    expect(logins).toContain("jac-carol");
  });
});

describe("favourite edge cases", () => {
  test("favourite on unpublished paper → error", async () => {
    const user = await createTestUser({ githubLogin: "fav-unp" });
    const paper = await createTestPaper(user.id, { status: "submitted" });

    const { error } = await runCliError(
      "favourite", "toggle", paper.paperId, "--as", "fav-unp",
    );
    expect(error).toContain("Paper not found");
  });

  test("favourite toggle cycle: on → off → on", async () => {
    const user = await createTestUser({ githubLogin: "fav-cycle" });
    const paper = await createTestPaper(user.id, { status: "published" });

    // Toggle ON
    const { data: on1 } = await runCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "fav-cycle",
    );
    expect(on1.favourited).toBe(true);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(1);

    // Toggle OFF
    const { data: off } = await runCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "fav-cycle",
    );
    expect(off.favourited).toBe(false);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(0);

    // Toggle ON again
    const { data: on2 } = await runCliJson<{ favourited: boolean }>(
      "favourite", "toggle", paper.paperId, "--as", "fav-cycle",
    );
    expect(on2.favourited).toBe(true);
    expect(await prisma.favourite.count({ where: { paperId: paper.id } })).toBe(1);
  });
});

describe("read marking edge cases", () => {
  test("read mark on unpublished paper → error", async () => {
    const user = await createTestUser({ githubLogin: "read-unp" });
    const paper = await createTestPaper(user.id, { status: "submitted" });

    const { error } = await runCliError(
      "read", "mark", paper.paperId, "--as", "read-unp",
    );
    expect(error).toContain("Paper not found");
  });
});
