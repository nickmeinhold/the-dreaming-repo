"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePaperStatus } from "@/lib/actions/editorial";

interface Props {
  paperId: string;
  currentStatus: string;
  validStatuses: string[];
}

export function StatusTransition({ paperId, currentStatus, validStatuses }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (validStatuses.length === 0) return null;

  async function transition(newStatus: string) {
    setLoading(true);
    const result = await updatePaperStatus(paperId, newStatus);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">Move to:</span>
      {validStatuses.map((status) => (
        <button
          key={status}
          onClick={() => transition(status)}
          disabled={loading}
          data-testid={`transition-${status}`}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-border/30 disabled:opacity-50"
        >
          {status}
        </button>
      ))}
    </div>
  );
}
