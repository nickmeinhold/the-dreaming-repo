"use client";

import { useState } from "react";
import { markAsRead } from "@/lib/actions/social";

interface Props {
  paperId: string;
  initialRead: boolean;
}

export function ReadMarker({ paperId, initialRead }: Props) {
  const [read, setRead] = useState(initialRead);
  const [loading, setLoading] = useState(false);

  async function handleMark() {
    if (read) return;
    setLoading(true);
    const result = await markAsRead(paperId);
    if (result.success) setRead(true);
    setLoading(false);
  }

  return (
    <button
      onClick={handleMark}
      disabled={loading || read}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
        read
          ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
          : "border-border text-muted hover:border-foreground hover:text-foreground"
      }`}
    >
      {read ? "Read" : "Mark as read"}
    </button>
  );
}
