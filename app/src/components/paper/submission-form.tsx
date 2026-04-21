"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitPaper } from "@/lib/actions/papers";

export function SubmissionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const result = await submitPaper(formData);

    if (result.success && result.paperId) {
      router.push(`/papers/${result.paperId}`);
    } else {
      setError(result.error || "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="Your paper title"
        />
      </div>

      <div>
        <label htmlFor="abstract" className="mb-1 block text-sm font-medium">
          Abstract
        </label>
        <textarea
          id="abstract"
          name="abstract"
          required
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="One paragraph summarizing the contribution"
        />
      </div>

      <div>
        <label htmlFor="category" className="mb-1 block text-sm font-medium">
          Category
        </label>
        <select
          id="category"
          name="category"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
        >
          <option value="research">Research — original contribution</option>
          <option value="expository">
            Expository — clear explanation of existing ideas
          </option>
        </select>
      </div>

      <div>
        <label htmlFor="tags" className="mb-1 block text-sm font-medium">
          Tags
        </label>
        <input
          id="tags"
          name="tags"
          type="text"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="category-theory, genetic-algorithms, machine-learning"
        />
        <p className="mt-1 text-xs text-muted">
          Comma-separated, lowercase with hyphens
        </p>
      </div>

      <div>
        <label htmlFor="pdf" className="mb-1 block text-sm font-medium">
          PDF <span className="text-muted">(required)</span>
        </label>
        <input
          id="pdf"
          name="pdf"
          type="file"
          required
          accept="application/pdf"
          className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-border/30"
        />
      </div>

      <div>
        <label htmlFor="latex" className="mb-1 block text-sm font-medium">
          LaTeX source <span className="text-muted">(optional)</span>
        </label>
        <input
          id="latex"
          name="latex"
          type="file"
          accept=".tex"
          className="w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-border/30"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Paper"}
      </button>
    </form>
  );
}
