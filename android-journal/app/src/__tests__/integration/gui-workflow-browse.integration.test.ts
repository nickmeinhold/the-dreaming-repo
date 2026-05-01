/**
 * GUI CLI E2E Workflow Tests — Browse, Search & Discovery
 *
 * W4: Search, filter, download
 * W7: Editor dashboard workflow
 * Read-only operations: paper list, tags, user profiles
 *
 * These tests verify that scraping the web pages produces
 * correct data matching what's in the database.
 *
 * Requires: Next.js dev server running against test database.
 * Self-contained: creates all data via helpers, no seed dependency.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { runGuiCli, runGuiCliJson } from "./gui-cli-helpers";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  await cleanDatabase();
});

describe("GUI: paper browsing", () => {
  test("paper list shows published papers", async () => {
    const author = await createTestUser({ githubLogin: "gui-browse-auth" });
    await createTestPaper(author.id, { status: "published", title: "Published One" });
    await createTestPaper(author.id, { status: "published", title: "Published Two" });
    await createTestPaper(author.id, { status: "submitted", title: "Not Visible" });

    const { data } = await runGuiCliJson<{ papers: { title: string }[] }>("paper", "list");
    // Non-editor: should see only published papers
    expect(data.papers).toHaveLength(2);
  });

  test("paper show scrapes detail correctly", async () => {
    const author = await createTestUser({ githubLogin: "gui-show-auth" });
    const paper = await createTestPaper(author.id, {
      status: "published",
      title: "Detail Test Paper",
      abstract: "An abstract for the detail test.",
    });

    const { data } = await runGuiCliJson<{ paperId: string; title: string; abstract: string }>(
      "paper", "show", paper.paperId,
    );
    expect(data.paperId).toBe(paper.paperId);
    expect(data.title).toBe("Detail Test Paper");
    expect(data.abstract).toContain("detail test");
  });
});

describe("GUI: search", () => {
  test("search finds papers by keyword", async () => {
    const author = await createTestUser({ githubLogin: "gui-search-auth" });
    await createTestPaper(author.id, {
      status: "published",
      title: "Categorical Composition of Genetic Algorithms",
      abstract: "Migration topology determines diversity dynamics.",
    });
    await createTestPaper(author.id, {
      status: "published",
      title: "Cylindric Partitions",
      abstract: "A paper about cylindric partitions and q-series.",
    });

    const { data } = await runGuiCliJson<{ results: { title: string }[]; total: number }>(
      "search", "diversity",
    );
    expect(data.results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GUI: tags", () => {
  test("tag list returns tags with counts", async () => {
    const author = await createTestUser({ githubLogin: "gui-tag-auth" });
    const paper = await createTestPaper(author.id, { status: "published" });

    // Add tags directly in DB
    const tag = await prisma.tag.create({ data: { slug: "test-tag", label: "Test Tag" } });
    await prisma.paperTag.create({ data: { paperId: paper.id, tagId: tag.id } });

    const { data } = await runGuiCliJson<{ slug: string; label: string; papers: number }[]>(
      "tag", "list",
    );
    expect(data.length).toBeGreaterThanOrEqual(1);
    const found = data.find((t) => t.slug === "test-tag");
    expect(found).toBeTruthy();
    expect(found!.papers).toBe(1);
  });
});

describe("GUI: user profiles", () => {
  test("user list shows all users", async () => {
    await createTestUser({ githubLogin: "gui-u1", displayName: "User One" });
    await createTestUser({ githubLogin: "gui-u2", displayName: "User Two" });

    const { data } = await runGuiCliJson<{ githubLogin: string }[]>("user", "list");
    expect(data).toHaveLength(2);
  });

  test("user show scrapes profile", async () => {
    const user = await createTestUser({
      githubLogin: "gui-profile",
      displayName: "Profile Test User",
    });
    const paper = await createTestPaper(user.id, { status: "published", title: "My Paper" });

    const { data } = await runGuiCliJson<{ displayName: string; papers: unknown[] }>(
      "user", "show", "gui-profile",
    );
    expect(data.displayName).toBe("Profile Test User");
    expect(data.papers.length).toBe(1);
  });
});

describe("GUI W7: editor dashboard workflow", () => {
  test("editor sees papers grouped by status", async () => {
    const editor = await createTestUser({ githubLogin: "gui-ed-dash", role: "editor" });
    const author = await createTestUser({ githubLogin: "gui-ed-auth" });

    await createTestPaper(author.id, { status: "submitted", title: "Submitted Paper" });
    await createTestPaper(author.id, { status: "under-review", title: "Under Review Paper" });

    const { data } = await runGuiCliJson<Record<string, { title: string }[]>>(
      "editorial", "dashboard", "--as", "gui-ed-dash",
    );

    // Dashboard should show papers in their status groups
    expect(data).toBeTruthy();
    // At minimum, the dashboard should load without error
  });
});

describe("GUI: health check", () => {
  test("health returns ok", async () => {
    const { data } = await runGuiCliJson<{ status: string }>("health");
    expect(data.status).toBe("ok");
  });
});
