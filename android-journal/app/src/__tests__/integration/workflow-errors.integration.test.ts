/**
 * CLI E2E Workflow Tests — Error Paths & State Machine
 *
 * Exhaustive testing of all invalid state transitions (ERR13-ERR22)
 * plus editor/admin boundary cases.
 *
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { runCli, runCliJson, runCliError } from "./cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

let editorLogin: string;

beforeEach(async () => {
  await cleanDatabase();
  await createTestUser({ githubLogin: "err-editor", role: "editor" });
  editorLogin = "err-editor";
});

// ── Invalid State Transitions ────────────────────────────────

const INVALID_TRANSITIONS = [
  { from: "submitted", to: "published", label: "ERR13: submitted → published" },
  { from: "submitted", to: "accepted", label: "ERR14: submitted → accepted" },
  { from: "submitted", to: "revision", label: "ERR15: submitted → revision" },
  { from: "under-review", to: "submitted", label: "ERR16: under-review → submitted" },
  { from: "under-review", to: "published", label: "ERR17: under-review → published" },
  { from: "accepted", to: "under-review", label: "ERR18: accepted → under-review" },
  { from: "accepted", to: "revision", label: "ERR19: accepted → revision" },
  { from: "published", to: "under-review", label: "ERR20a: published → under-review" },
  { from: "published", to: "revision", label: "ERR20b: published → revision" },
  { from: "published", to: "submitted", label: "ERR20c: published → submitted" },
  { from: "revision", to: "accepted", label: "ERR21: revision → accepted" },
  { from: "revision", to: "published", label: "ERR22: revision → published" },
];

describe("invalid state transitions", () => {
  test.each(INVALID_TRANSITIONS)(
    "$label should be rejected",
    async ({ from, to }) => {
      const author = await createTestUser();
      const paper = await createTestPaper(author.id, { status: from });

      const { error } = await runCliError(
        "editorial", "status", paper.paperId, to, "--as", editorLogin,
      );
      expect(error).toContain("Cannot transition");
    },
  );
});

// ── Editor Boundary Cases ────────────────────────────────────

describe("editor boundaries", () => {
  test("editor can view unpublished paper detail", async () => {
    const author = await createTestUser({ githubLogin: "view-auth" });
    const paper = await createTestPaper(author.id, {
      status: "submitted",
      title: "Secret Draft",
    });

    const { data } = await runCliJson<{ title: string; status: string }>(
      "paper", "show", paper.paperId, "--as", editorLogin,
    );
    expect(data.title).toBe("Secret Draft");
    expect(data.status).toBe("submitted");
  });

  test("editor can add note on unpublished paper", async () => {
    const author = await createTestUser({ githubLogin: "note-auth" });
    const paper = await createTestPaper(author.id, { status: "under-review" });

    const { data } = await runCliJson<{ id: number; content: string }>(
      "note", "add", paper.paperId, "Editor review note", "--as", editorLogin,
    );
    expect(data.content).toBe("Editor review note");

    const note = await prisma.note.findUnique({ where: { id: data.id } });
    expect(note).toBeTruthy();
  });

  test("promote user to editor → editorial actions work", async () => {
    const user = await createTestUser({ githubLogin: "will-promote" });
    const author = await createTestUser({ githubLogin: "promo-auth" });
    const paper = await createTestPaper(author.id, { status: "submitted" });

    // Promote
    await runCli("user", "promote", "will-promote", "--role", "editor");
    const promoted = await prisma.user.findUnique({ where: { githubLogin: "will-promote" } });
    expect(promoted!.role).toBe("editor");

    // Editorial action now works
    const { data } = await runCliJson(
      "editorial", "status", paper.paperId, "under-review", "--as", "will-promote",
    );
    expect(data).toMatchObject({ status: "under-review" });
  });

  test("demote editor to user → editorial actions blocked", async () => {
    const exEditor = await createTestUser({ githubLogin: "will-demote", role: "editor" });
    const author = await createTestUser({ githubLogin: "demote-auth" });
    const paper1 = await createTestPaper(author.id, { status: "submitted" });

    // Verify editorial works before demotion
    await runCli("editorial", "status", paper1.paperId, "under-review", "--as", "will-demote");

    // Demote
    await runCli("user", "promote", "will-demote", "--role", "user");

    // Create new submitted paper
    const paper2 = await createTestPaper(author.id, { status: "submitted" });

    // Editorial action now blocked
    const { error } = await runCliError(
      "editorial", "status", paper2.paperId, "under-review", "--as", "will-demote",
    );
    expect(error).toContain("not an editor");
  });
});
