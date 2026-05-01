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
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="submit-form">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="submit-error">
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
          data-testid="submit-title"
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
          data-testid="submit-abstract"
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
          data-testid="submit-category"
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
          data-testid="submit-tags"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
          placeholder="category-theory, genetic-algorithms, machine-learning"
        />
        <p className="mt-1 text-xs text-muted">
          Comma-separated, lowercase with hyphens
        </p>
      </div>

      <div>
        <label htmlFor="pdf" className="mb-1 block text-sm font-medium">
          Paper PDF <span className="text-muted">(required, max 50 MB)</span>
        </label>
        <input
          id="pdf"
          name="pdf"
          type="file"
          required
          accept="application/pdf,.pdf"
          data-testid="submit-pdf"
          className="w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-border/30"
        />
        <p className="mt-1 text-xs text-muted">
          If your paper is written in LaTeX, please also upload the source below
          so readers can learn from your typesetting.
        </p>
      </div>

      <div>
        <label htmlFor="latex" className="mb-1 block text-sm font-medium">
          LaTeX source <span className="text-muted">(optional, max 5 MB)</span>
        </label>
        <input
          id="latex"
          name="latex"
          type="file"
          accept=".tex,application/x-tex"
          data-testid="submit-latex"
          className="w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-border/30"
        />
        <p className="mt-1 text-xs text-muted">
          The .tex source is stored as-is for download — it is not compiled on
          the server. Readers who download it can compile it themselves.
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        data-testid="submit-button"
        className="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Paper"}
      </button>
    </form>
  );
}
