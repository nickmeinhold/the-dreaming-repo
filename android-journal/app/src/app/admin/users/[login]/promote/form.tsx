"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { promoteUser } from "@/lib/actions/users";

interface Props {
  login: string;
  currentRole: string;
}

export function PromoteForm({ login, currentRole }: Props) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await promoteUser(login, role);

    if (result.success) {
      router.push(`/users/${login}`);
    } else {
      setError(result.error || "Update failed");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="promote-error">
          {error}
        </div>
      )}

      <div>
        <p className="mb-2 text-sm text-muted">
          Current role: <span className="font-medium text-foreground" data-testid="promote-current">{currentRole}</span>
        </p>
        <label htmlFor="role" className="mb-1 block text-sm font-medium">New Role</label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          data-testid="promote-select"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
        >
          <option value="user">User</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={submitting || role === currentRole}
        data-testid="promote-submit"
        className="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? "Updating..." : "Update Role"}
      </button>
    </form>
  );
}
