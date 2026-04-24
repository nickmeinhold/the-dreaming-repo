"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitReview } from "@/lib/actions/reviews";

interface ReviewFormProps {
  paperId: string;
  paperTitle: string;
  existingReview?: {
    noveltyScore: number;
    correctnessScore: number;
    clarityScore: number;
    significanceScore: number;
    priorWorkScore: number;
    summary: string;
    strengths: string;
    weaknesses: string;
    questions: string;
    connections: string;
    verdict: string;
    buildOn: string | null;
  };
}

const CRITERIA = [
  { key: "noveltyScore", label: "Novelty", hint: "New results, connections, perspectives" },
  { key: "correctnessScore", label: "Correctness", hint: "Claims supported, proofs valid" },
  { key: "clarityScore", label: "Clarity", hint: "Well-written, followable, terms defined" },
  { key: "significanceScore", label: "Significance", hint: "Will people build on this?" },
  { key: "priorWorkScore", label: "Prior Work", hint: "Cites relevant existing work" },
] as const;

const VERDICTS = [
  { value: "accept", label: "Accept", description: "Clear contribution, correct, well-written" },
  { value: "minor-revision", label: "Minor Revision", description: "Sound core, presentation needs polish" },
  { value: "major-revision", label: "Major Revision", description: "Interesting idea, significant gaps" },
  { value: "reject", label: "Reject", description: "Fundamental issues (must include guidance)" },
];

export function ReviewForm({ paperId, paperTitle, existingReview }: ReviewFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [scores, setScores] = useState<Record<string, number>>({
    noveltyScore: existingReview?.noveltyScore || 3,
    correctnessScore: existingReview?.correctnessScore || 3,
    clarityScore: existingReview?.clarityScore || 3,
    significanceScore: existingReview?.significanceScore || 3,
    priorWorkScore: existingReview?.priorWorkScore || 3,
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);

    const result = await submitReview(paperId, {
      noveltyScore: scores.noveltyScore,
      correctnessScore: scores.correctnessScore,
      clarityScore: scores.clarityScore,
      significanceScore: scores.significanceScore,
      priorWorkScore: scores.priorWorkScore,
      summary: (form.get("summary") as string) || "",
      strengths: (form.get("strengths") as string) || "",
      weaknesses: (form.get("weaknesses") as string) || "",
      questions: (form.get("questions") as string) || "",
      connections: (form.get("connections") as string) || "",
      verdict: (form.get("verdict") as string) || "",
      buildOn: (form.get("buildOn") as string) || "",
    });

    if (result.success) {
      router.push(`/papers/${paperId}`);
    } else {
      setError(result.error || "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <p className="text-sm text-muted">
        Reviewing: <span className="font-serif font-semibold text-foreground">{paperTitle}</span>
      </p>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Scores */}
      <section>
        <h2 className="mb-4 font-serif text-lg font-semibold">Scores</h2>
        <div className="space-y-4">
          {CRITERIA.map((c) => (
            <div key={c.key} className="flex items-center gap-4">
              <div className="w-32">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-muted">{c.hint}</div>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScores((s) => ({ ...s, [c.key]: n }))}
                    className={`h-9 w-9 rounded-md border text-sm font-medium transition-colors ${
                      scores[c.key] === n
                        ? "border-link bg-link text-white"
                        : "border-border text-muted hover:border-foreground hover:text-foreground"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Text fields */}
      <TextArea name="summary" label="Summary" rows={3} hint="2-4 sentences. What does the paper do?" defaultValue={existingReview?.summary} required />
      <TextArea name="strengths" label="Strengths" rows={5} hint="Be specific — quote passages, reference sections" defaultValue={existingReview?.strengths} required />
      <TextArea name="weaknesses" label="Weaknesses" rows={5} hint="For each: what, where, why, how to fix" defaultValue={existingReview?.weaknesses} required />
      <TextArea name="questions" label="Questions for the Author" rows={3} hint="Genuine questions, not rhetorical criticisms" defaultValue={existingReview?.questions} />
      <TextArea name="connections" label="Connections" rows={3} hint="Related work in the journal or elsewhere" defaultValue={existingReview?.connections} />

      {/* Verdict */}
      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold">Verdict</h2>
        <div className="space-y-2">
          {VERDICTS.map((v) => (
            <label key={v.value} className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-border/20 cursor-pointer">
              <input
                type="radio"
                name="verdict"
                value={v.value}
                defaultChecked={existingReview?.verdict === v.value}
                required
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium">{v.label}</div>
                <div className="text-xs text-muted">{v.description}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <TextArea name="buildOn" label="Would I Build on This?" rows={3} hint="Your honest answer — the social signal" defaultValue={existingReview?.buildOn ?? ""} />

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent px-4 py-3 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? "Submitting Review..." : "Submit Review"}
      </button>
    </form>
  );
}

function TextArea({
  name,
  label,
  rows,
  hint,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  rows: number;
  hint: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
      />
    </div>
  );
}
