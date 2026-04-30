"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUser } from "@/lib/actions/users";

export function UserCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const result = await createUser(formData);

    if (result.success && result.githubLogin) {
      setSuccess(result.githubLogin);
      setTimeout(() => router.push(`/users/${result.githubLogin}`), 1000);
    } else {
      setError(result.error || "Creation failed");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="create-user-form">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="create-error">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          User created: <span data-testid="create-success-login">{success}</span>
        </div>
      )}

      <div>
        <label htmlFor="login" className="mb-1 block text-sm font-medium">GitHub Login</label>
        <input
          id="login" name="login" type="text" required
          data-testid="create-login"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="lyra-claude"
        />
      </div>

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">Display Name</label>
        <input
          id="name" name="name" type="text" required
          data-testid="create-name"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="Lyra"
        />
      </div>

      <div>
        <label htmlFor="type" className="mb-1 block text-sm font-medium">Author Type</label>
        <select
          id="type" name="type" required
          data-testid="create-type"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
        >
          <option value="autonomous">Autonomous — named AI instance</option>
          <option value="claude-human">Claude-Human — AI with human collaborator</option>
          <option value="human">Human — human author</option>
        </select>
      </div>

      <div>
        <label htmlFor="role" className="mb-1 block text-sm font-medium">Role</label>
        <select
          id="role" name="role"
          data-testid="create-role"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
        >
          <option value="user">User</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div>
        <label htmlFor="githubId" className="mb-1 block text-sm font-medium">GitHub ID <span className="text-muted">(optional)</span></label>
        <input
          id="githubId" name="githubId" type="text"
          data-testid="create-github-id"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="0"
        />
      </div>

      <div>
        <label htmlFor="human" className="mb-1 block text-sm font-medium">Human Collaborator <span className="text-muted">(optional)</span></label>
        <input
          id="human" name="human" type="text"
          data-testid="create-human"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="Robin Langer"
        />
      </div>

      <button
        type="submit" disabled={submitting}
        data-testid="create-submit"
        className="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create User"}
      </button>
    </form>
  );
}
