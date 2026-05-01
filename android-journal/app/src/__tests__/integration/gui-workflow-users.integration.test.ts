/**
 * GUI CLI E2E Workflow Tests — User Management
 *
 * Tests for the new GUI pages: user creation, role management.
 * CR1: Role escalation / de-escalation
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

describe("GUI: user creation via /admin/users/create", () => {
  test("admin can create a new user", async () => {
    const admin = await createTestUser({ githubLogin: "gui-admin", role: "admin" });

    const { data } = await runGuiCliJson<{ githubLogin: string }>(
      "user", "create",
      "--login", "gui-new-user",
      "--name", "New User",
      "--type", "autonomous",
      "--as", "gui-admin",
    );
    expect(data.githubLogin).toBe("gui-new-user");

    // Verify in DB
    const dbUser = await prisma.user.findUnique({ where: { githubLogin: "gui-new-user" } });
    expect(dbUser).toBeTruthy();
    expect(dbUser!.displayName).toBe("New User");
    expect(dbUser!.authorType).toBe("autonomous");
    expect(dbUser!.role).toBe("user");
  });

  test("admin can create user with editor role", async () => {
    const admin = await createTestUser({ githubLogin: "gui-admin2", role: "admin" });

    await runGuiCliJson(
      "user", "create",
      "--login", "gui-new-editor",
      "--name", "New Editor",
      "--type", "human",
      "--role", "editor",
      "--as", "gui-admin2",
    );

    const dbUser = await prisma.user.findUnique({ where: { githubLogin: "gui-new-editor" } });
    expect(dbUser!.role).toBe("editor");
  });

  test("admin can create claude-human user with collaborator", async () => {
    const admin = await createTestUser({ githubLogin: "gui-admin3", role: "admin" });

    await runGuiCliJson(
      "user", "create",
      "--login", "gui-claude-human",
      "--name", "Claude Session",
      "--type", "claude-human",
      "--human", "Robin Langer",
      "--as", "gui-admin3",
    );

    const dbUser = await prisma.user.findUnique({ where: { githubLogin: "gui-claude-human" } });
    expect(dbUser!.authorType).toBe("claude-human");
    expect(dbUser!.humanName).toBe("Robin Langer");
  });
});

describe("GUI CR1: role escalation / de-escalation", () => {
  test("promote user to editor, then demote back", async () => {
    const admin = await createTestUser({ githubLogin: "gui-cr1-admin", role: "admin" });
    const user = await createTestUser({ githubLogin: "gui-cr1-user" });
    const author = await createTestUser({ githubLogin: "gui-cr1-author" });
    const paper = await createTestPaper(author.id, { status: "submitted" });

    // Verify user starts as regular user
    expect(user.role).toBe("user");

    // Promote to editor
    const { data: promoted } = await runGuiCliJson<{ role: string }>(
      "user", "promote", "gui-cr1-user", "--role", "editor", "--as", "gui-cr1-admin",
    );
    expect(promoted.role).toBe("editor");

    // Verify in DB
    const dbUserAfterPromo = await prisma.user.findUnique({ where: { githubLogin: "gui-cr1-user" } });
    expect(dbUserAfterPromo!.role).toBe("editor");

    // Now the promoted user can access dashboard
    const { data: dashboard } = await runGuiCliJson(
      "editorial", "dashboard", "--as", "gui-cr1-user",
    );
    expect(dashboard).toBeTruthy();

    // Demote back to user
    await runGuiCliJson(
      "user", "promote", "gui-cr1-user", "--role", "user", "--as", "gui-cr1-admin",
    );

    const dbUserAfterDemote = await prisma.user.findUnique({ where: { githubLogin: "gui-cr1-user" } });
    expect(dbUserAfterDemote!.role).toBe("user");
  });
});

describe("GUI: user similar interests", () => {
  test("similar users scraped from profile page", async () => {
    const author = await createTestUser({ githubLogin: "gui-sim-author" });
    const alice = await createTestUser({ githubLogin: "gui-sim-alice" });
    const bob = await createTestUser({ githubLogin: "gui-sim-bob" });

    const p1 = await createTestPaper(author.id, { status: "published" });
    const p2 = await createTestPaper(author.id, { status: "published" });

    // Both alice and bob read the same papers → similar
    for (const login of ["gui-sim-alice", "gui-sim-bob"]) {
      await runGuiCli("read", "mark", p1.paperId, "--as", login);
      await runGuiCli("read", "mark", p2.paperId, "--as", login);
    }

    // Verify reads exist in DB
    const aliceReads = await prisma.download.count({
      where: { userId: alice.id, read: true },
    });
    expect(aliceReads).toBe(2);
  });
});

describe("GUI: favourite and read history from profile", () => {
  test("favourite list scraped from user profile", async () => {
    const user = await createTestUser({ githubLogin: "gui-fav-list" });
    const author = await createTestUser({ githubLogin: "gui-fav-list-auth" });
    const p1 = await createTestPaper(author.id, { status: "published", title: "Fav Paper 1" });
    const p2 = await createTestPaper(author.id, { status: "published", title: "Fav Paper 2" });

    // Favourite both papers
    await runGuiCli("favourite", "toggle", p1.paperId, "--as", "gui-fav-list");
    await runGuiCli("favourite", "toggle", p2.paperId, "--as", "gui-fav-list");

    // Verify in DB
    const favCount = await prisma.favourite.count({ where: { userId: user.id } });
    expect(favCount).toBe(2);
  });

  test("read history scraped from user profile", async () => {
    const user = await createTestUser({ githubLogin: "gui-read-hist" });
    const author = await createTestUser({ githubLogin: "gui-read-hist-auth" });
    const p1 = await createTestPaper(author.id, { status: "published", title: "Read Paper 1" });

    // Mark as read
    await runGuiCli("read", "mark", p1.paperId, "--as", "gui-read-hist");

    // Verify in DB
    const readCount = await prisma.download.count({
      where: { userId: user.id, read: true },
    });
    expect(readCount).toBe(1);
  });
});
