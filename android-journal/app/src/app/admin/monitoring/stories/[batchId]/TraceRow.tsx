"use client";

import { useState } from "react";

interface TraceEvent {
  id: number;
  action: string;
  entity: string;
  entityId: string;
  timestamp: string;
  details: string | null;
  durationMs?: number | null;
  status?: string | null;
  correlationId: string | null;
}

function parseDetails(d: string | null): {
  input?: { as?: string; args?: string[] };
  steps?: string;
  ms?: number;
  status?: string;
  error?: string;
} {
  if (!d) return {};
  try {
    return JSON.parse(d);
  } catch {
    return {};
  }
}

function formatAction(action: string): string {
  // trace.cli.paper.submit → paper.submit
  return action.replace(/^trace\.cli\./, "");
}

const STATUS_COLORS: Record<string, string> = {
  ok: "#059669",
  err: "#dc2626",
};

export function TraceRow({ event }: { event: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const det = parseDetails(event.details);
  const hasSteps = !!det.steps;
  const action = formatAction(event.action);
  const effectiveStatus = event.status ?? det.status;
  const effectiveMs = event.durationMs ?? det.ms;
  const statusColor = STATUS_COLORS[effectiveStatus ?? ""] ?? "#6b7280";

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      {/* Summary row */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: "10px",
          padding: "8px 12px", cursor: hasSteps ? "pointer" : "default",
          fontSize: "0.85rem",
        }}
      >
        {/* Expand arrow */}
        <span style={{ width: "16px", color: "#9ca3af", fontSize: "0.7rem" }}>
          {hasSteps ? (open ? "\u25be" : "\u25b8") : " "}
        </span>

        {/* Status dot */}
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%",
          backgroundColor: statusColor, flexShrink: 0,
        }} />

        {/* Action badge */}
        <span style={{
          padding: "1px 6px", borderRadius: "3px", fontSize: "0.7rem",
          fontWeight: "bold", color: "#fff", backgroundColor: "#3b82f6",
          whiteSpace: "nowrap",
        }}>
          {action}
        </span>

        {/* Entity */}
        <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>
          {event.entityId}
        </span>

        {/* Actor */}
        {det.input?.as && (
          <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
            --as {det.input.as}
          </span>
        )}

        {/* Duration */}
        {effectiveMs != null && effectiveMs > 0 && (
          <span style={{
            marginLeft: "auto", fontSize: "0.8rem",
            color: effectiveMs > 200 ? "#f59e0b" : "#9ca3af",
          }}>
            {effectiveMs}ms
          </span>
        )}

        {/* Trace link */}
        {event.correlationId && (
          <a
            href={`/admin/monitoring/trace/${event.correlationId}`}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: "0.65rem", color: "#6366f1", textDecoration: "none" }}
          >
            trace
          </a>
        )}
      </div>

      {/* Expanded step flow */}
      {open && hasSteps && (
        <div style={{
          padding: "4px 12px 12px 46px",
          borderLeft: "2px solid #e5e7eb", marginLeft: "20px",
        }}>
          {det.steps!.split(" \u2192 ").map((step, i) => {
            const [name, status] = step.split(":");
            const isErr = status === "err";
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "8px",
                fontSize: "0.8rem", padding: "2px 0",
              }}>
                <span style={{ color: isErr ? "#dc2626" : "#059669", fontSize: "0.85rem" }}>
                  {isErr ? "\u2717" : "\u2713"}
                </span>
                <span style={{
                  color: isErr ? "#dc2626" : "#374151",
                  fontWeight: isErr ? "bold" : "normal",
                }}>
                  {name}
                </span>
              </div>
            );
          })}

          {/* Error message */}
          {det.error && (
            <div style={{
              marginTop: "6px", padding: "6px 10px",
              backgroundColor: "#fef2f2", borderRadius: "4px",
              color: "#dc2626", fontSize: "0.8rem",
            }}>
              {det.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
