/**
 * Integration Tests — Search & Interest Matching
 *
 * Tests PostgreSQL full-text search (tsvector/plainto_tsquery) and
 * Jaccard interest matching against a real database with the
 * tsvector trigger active.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

// No auth mock needed — searchPapers and findSimilarUsers don't require auth
import { prisma } from "@/lib/db";
import { searchPapers } from "@/lib/search";
import { findSimilarUsers } from "@/lib/interest-matching";
import { cleanDatabase, createTestUser, createTestPaper } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
});

describe("Full-Text Search", () => {
  test("finds published paper by title keyword", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, {
      title: "Categorical Composition of Genetic Algorithms",
      status: "published",
    });

    const { results, total } = await searchPapers("categorical");

    expect(total).toBe(1);
    expect(results[0].title).toContain("Categorical");
  });

  test("finds published paper by abstract keyword", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, {
      title: "A Simple Title",
      abstract:
        "We investigate cylindric partitions and their connection to Rogers-Ramanujan identities.",
      status: "published",
    });

    const { results } = await searchPapers("cylindric partitions");

    expect(results).toHaveLength(1);
  });

  test("does not return unpublished papers", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, {
      title: "Secret Unpublished Work",
      status: "submitted",
    });

    const { results, total } = await searchPapers("secret");

    expect(total).toBe(0);
    expect(results).toHaveLength(0);
  });

  test("title match ranks higher than abstract match", async () => {
    const user = await createTestUser();

    // Paper with "topology" in title (weight A)
    await createTestPaper(user.id, {
      title: "Migration Topology in Evolutionary Systems",
      abstract: "We study population dynamics.",
      status: "published",
      paperId: "2026-050",
    });

    // Paper with "topology" only in abstract (weight B)
    await createTestPaper(user.id, {
      title: "Population Dynamics Analysis",
      abstract: "The migration topology determines diversity.",
      status: "published",
      paperId: "2026-051",
    });

    const { results } = await searchPapers("topology");

    expect(results).toHaveLength(2);
    // Title match should rank first (weight A > weight B)
    expect(results[0].paperId).toBe("2026-050");
  });

  test("filters by category", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, {
      title: "Research on Monads",
      category: "research",
      status: "published",
      paperId: "2026-060",
    });
    await createTestPaper(user.id, {
      title: "Expository Guide to Monads",
      category: "expository",
      status: "published",
      paperId: "2026-061",
    });

    const { results, total } = await searchPapers("monads", {
      category: "expository",
    });

    expect(total).toBe(1);
    expect(results[0].category).toBe("expository");
  });

  test("empty query returns zero results", async () => {
    const user = await createTestUser();
    await createTestPaper(user.id, {
      title: "Something Findable",
      status: "published",
    });

    const { results, total } = await searchPapers("");

    expect(total).toBe(0);
    expect(results).toHaveLength(0);
  });

  test("sanitises dangerous input without crashing", async () => {
    const { results, total } = await searchPapers("'; DROP TABLE \"Paper\"--");

    expect(total).toBe(0);
    expect(results).toHaveLength(0);
  });
});

describe("Interest Matching — Jaccard Similarity", () => {
  test("finds users with overlapping reading history", async () => {
    const alice = await createTestUser({ githubLogin: "alice" });
    const bob = await createTestUser({ githubLogin: "bob" });
    const author = await createTestUser();

    // Create 3 published papers
    const p1 = await createTestPaper(author.id, {
      status: "published",
      paperId: "2026-070",
    });
    const p2 = await createTestPaper(author.id, {
      status: "published",
      paperId: "2026-071",
    });
    const p3 = await createTestPaper(author.id, {
      status: "published",
      paperId: "2026-072",
    });

    // Alice reads p1 and p2
    await prisma.download.create({
      data: { paperId: p1.id, userId: alice.id, read: true },
    });
    await prisma.download.create({
      data: { paperId: p2.id, userId: alice.id, read: true },
    });

    // Bob reads p2 and p3
    await prisma.download.create({
      data: { paperId: p2.id, userId: bob.id, read: true },
    });
    await prisma.download.create({
      data: { paperId: p3.id, userId: bob.id, read: true },
    });

    const similar = await findSimilarUsers(alice.id);

    expect(similar).toHaveLength(1);
    expect(similar[0].githubLogin).toBe("bob");
    // Jaccard: |{p2}| / |{p1, p2, p3}| = 1/3
    expect(similar[0].overlap).toBe(1);
    expect(similar[0].similarity).toBeCloseTo(1 / 3, 5);
  });

  test("returns empty for user with no reads", async () => {
    const user = await createTestUser();
    const similar = await findSimilarUsers(user.id);
    expect(similar).toHaveLength(0);
  });

  test("ignores reads on unpublished papers", async () => {
    const alice = await createTestUser({ githubLogin: "alice2" });
    const bob = await createTestUser({ githubLogin: "bob2" });
    const author = await createTestUser();

    const unpublished = await createTestPaper(author.id, {
      status: "submitted",
      paperId: "2026-080",
    });

    // Both read the unpublished paper
    await prisma.download.create({
      data: { paperId: unpublished.id, userId: alice.id, read: true },
    });
    await prisma.download.create({
      data: { paperId: unpublished.id, userId: bob.id, read: true },
    });

    const similar = await findSimilarUsers(alice.id);
    expect(similar).toHaveLength(0);
  });
});
