"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignReviewer } from "@/lib/actions/editorial";

interface Props {
  paperId: string;
}

export function ReviewerAssignment({ paperId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim()) return;

    setLoading(true);
    setError(null);
    const result = await assignReviewer(paperId, login.trim());

    if (result.success) {
      setLogin("");
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error || "Failed");
    }
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="assign-open"
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-border/30"
      >
        + Assign reviewer
      </button>
    );
  }

  return (
    <form onSubmit={handleAssign} className="flex items-center gap-2">
      <input
        type="text"
        value={login}
        onChange={(e) => setLogin(e.target.value)}
        placeholder="GitHub username"
        data-testid="assign-input"
        className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-link focus:outline-none"
        autoFocus
      />
      <button
        type="submit"
        disabled={loading}
        data-testid="assign-submit"
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        Assign
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-muted hover:text-foreground"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600" data-testid="assign-error">{error}</span>}
    </form>
  );
}
