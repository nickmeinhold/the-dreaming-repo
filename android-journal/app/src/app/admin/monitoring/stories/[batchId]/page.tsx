/**
 * /admin/monitoring/stories/[batchId] — Story Detail
 *
 * Shows all commands in a single story run, grouped by chapter.
 * Each command row is expandable to show the step trace.
 */

import { prisma } from "@/lib/db";
import { TraceRow } from "./TraceRow";

interface ChapterInfo {
  chapter: number;
  name: string;
}

function parseChapterDetails(d: string | null): ChapterInfo | null {
  if (!d) return null;
  try {
    const p = JSON.parse(d);
    if (typeof p.chapter === "number" && typeof p.name === "string") {
      return { chapter: p.chapter, name: p.name };
    }
  } catch {}
  return null;
}

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;

  const events = await prisma.auditLog.findMany({
    where: { batchId },
    orderBy: { timestamp: "asc" },
  });

  if (events.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
        No events found for this story.
      </div>
    );
  }

  // Separate trace events (shown in chapters) from business logic events (misc)
  // Traces come from both CLI (trace.cli.*) and GUI CLI (trace.paper.*, trace.action.*, etc.)
  const isTrace = (action: string) => action.startsWith("trace.");
  const isTraceOrChapter = (action: string) =>
    isTrace(action) || action === "story.chapter";

  // Split events into chapters (trace events only)
  type Chapter = { info: ChapterInfo; events: typeof events };
  const chapters: Chapter[] = [];
  let currentChapter: Chapter | null = null;

  for (const e of events) {
    if (e.action === "story.chapter") {
      const info = parseChapterDetails(e.details);
      if (info) {
        currentChapter = { info, events: [] };
        chapters.push(currentChapter);
        continue;
      }
    }
    if (currentChapter && isTrace(e.action)) {
      currentChapter.events.push(e);
    }
  }

  // Misc: everything that isn't a trace or chapter marker
  const miscEvents = events.filter(e => !isTraceOrChapter(e.action));

  // Stats
  const traceCount = events.filter(e => isTrace(e.action)).length;
  const errorCount = events.filter(e => e.status === "err").length;
  const first = events[0];
  const last = events[events.length - 1];
  const durationSec = Math.round((last.timestamp.getTime() - first.timestamp.getTime()) / 1000);

  return (
    <>
      {/* Header */}
      <h2 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Story</h2>
      <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "1rem", fontFamily: "monospace" }}>
        {batchId}
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        <StatCard label="Chapters" value={chapters.length} />
        <StatCard label="Commands" value={traceCount} />
        <StatCard label="Side Effects" value={miscEvents.length} />
        <StatCard label="Errors" value={errorCount} color={errorCount > 0 ? "#dc2626" : "#059669"} />
        <StatCard label="Duration" value={`${durationSec}s`} />
      </div>

      {/* Chapters */}
      {chapters.map((ch) => (
        <div key={ch.info.chapter} style={{ marginBottom: "1.5rem" }}>
          {/* Chapter header */}
          <div style={{
            display: "flex", alignItems: "baseline", gap: "10px",
            padding: "8px 12px", backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb", borderRadius: "8px 8px 0 0",
          }}>
            <span style={{ fontSize: "0.7rem", fontWeight: "bold", color: "#9ca3af" }}>
              CH {ch.info.chapter}
            </span>
            <span style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#374151" }}>
              {ch.info.name}
            </span>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af", marginLeft: "auto" }}>
              {ch.events.length} commands
            </span>
          </div>

          {/* Command rows */}
          <div style={{ border: "1px solid #e5e7eb", borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
            {ch.events.length === 0 ? (
              <div style={{ padding: "12px", color: "#9ca3af", fontSize: "0.85rem", textAlign: "center" }}>
                (chapter marker only)
              </div>
            ) : (
              ch.events.map((e) => (
                <TraceRow
                  key={e.id}
                  event={{
                    id: e.id,
                    action: e.action,
                    entity: e.entity,
                    entityId: e.entityId,
                    timestamp: e.timestamp.toISOString(),
                    details: e.details,
                    durationMs: e.durationMs,
                    status: e.status,
                    correlationId: e.correlationId,
                  }}
                />
              ))
            )}
          </div>
        </div>
      ))}

      {/* Link to misc page */}
      {miscEvents.length > 0 && (
        <a
          href={`/admin/monitoring/stories/${batchId}/misc`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            padding: "12px", marginBottom: "1.5rem",
            backgroundColor: "#fefce8", border: "1px solid #fde68a", borderRadius: "8px",
            textDecoration: "none", color: "#92400e", fontSize: "0.85rem", fontWeight: "bold",
          }}
        >
          Side Effects ({miscEvents.length} events) &rarr;
        </a>
      )}
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: color ?? "#111827" }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}
