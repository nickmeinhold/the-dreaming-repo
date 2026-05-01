/**
 * /admin/monitoring/stories — Story Runs
 *
 * Lists all story seed runs. Each run is identified by a batchId
 * and shows chapter count, command count, and duration.
 */

import { prisma } from "@/lib/db";

export default async function StoriesPage() {
  // Find all chapter markers to identify story runs
  const chapters = await prisma.auditLog.findMany({
    where: { action: "story.chapter" },
    orderBy: { timestamp: "desc" },
  });

  // Group chapters by batchId
  const storyMap = new Map<string, { started: Date; chapterCount: number }>();
  for (const ch of chapters) {
    if (!ch.batchId) continue;
    const existing = storyMap.get(ch.batchId);
    if (!existing) {
      storyMap.set(ch.batchId, { started: ch.timestamp, chapterCount: 1 });
    } else {
      existing.chapterCount++;
      if (ch.timestamp < existing.started) existing.started = ch.timestamp;
    }
  }

  // Get command counts per batchId
  const batchIds = [...storyMap.keys()];
  const commandCounts = batchIds.length > 0
    ? await prisma.auditLog.groupBy({
        by: ["batchId"],
        where: { batchId: { in: batchIds }, action: { not: "story.chapter" } },
        _count: true,
      })
    : [];

  const countMap = new Map(commandCounts.map(c => [c.batchId, c._count]));

  // Get last event per batch for duration
  const stories = await Promise.all(
    batchIds.map(async (batchId) => {
      const last = await prisma.auditLog.findFirst({
        where: { batchId },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });
      const info = storyMap.get(batchId)!;
      const durationMs = last ? last.timestamp.getTime() - info.started.getTime() : 0;
      return {
        batchId,
        started: info.started,
        chapters: info.chapterCount,
        commands: countMap.get(batchId) ?? 0,
        durationSec: Math.round(durationMs / 1000),
      };
    }),
  );

  return (
    <>
      <h2 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Story Runs</h2>

      {stories.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          No story runs yet. Run <code>npx tsx scripts/seed-story.ts --clean</code> to create one.
        </div>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 80px 80px 80px", padding: "8px 12px", backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: "0.75rem", fontWeight: "bold", color: "#6b7280" }}>
            <span>Story ID</span>
            <span>Started</span>
            <span style={{ textAlign: "center" }}>Chapters</span>
            <span style={{ textAlign: "center" }}>Commands</span>
            <span style={{ textAlign: "right" }}>Duration</span>
          </div>

          {stories.map((s) => (
            <a
              key={s.batchId}
              href={`/admin/monitoring/stories/${s.batchId}`}
              style={{ display: "grid", gridTemplateColumns: "1fr 180px 80px 80px 80px", padding: "10px 12px", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit", fontSize: "0.85rem" }}
            >
              <span style={{ fontFamily: "monospace", color: "#6366f1" }}>
                {s.batchId.slice(0, 8)}...
              </span>
              <span style={{ color: "#6b7280" }}>
                {s.started.toISOString().replace("T", " ").slice(0, 19)}
              </span>
              <span style={{ textAlign: "center" }}>{s.chapters}</span>
              <span style={{ textAlign: "center" }}>{s.commands}</span>
              <span style={{ textAlign: "right", color: "#9ca3af" }}>{s.durationSec}s</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
