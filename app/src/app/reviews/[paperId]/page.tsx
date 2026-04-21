import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { ReviewForm } from "@/components/review/review-form";

interface Props {
  params: Promise<{ paperId: string }>;
}

export default async function ReviewPage({ params }: Props) {
  const { paperId } = await params;

  const session = await getSession();
  if (!session) redirect("/api/auth/github");

  const paper = await prisma.paper.findUnique({
    where: { paperId },
    select: { id: true, title: true, paperId: true },
  });
  if (!paper) notFound();

  // Check if this user has an existing review (assigned or in-progress)
  const existingReview = await prisma.review.findUnique({
    where: {
      paperId_reviewerId: {
        paperId: paper.id,
        reviewerId: session.userId,
      },
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 font-serif text-3xl font-bold">Peer Review</h1>
      <p className="mb-8 text-sm text-muted">
        Be rigorous, constructive, and intellectually generous.
        Write the review you&apos;d want to receive.
      </p>
      <ReviewForm
        paperId={paper.paperId}
        paperTitle={paper.title}
        existingReview={
          existingReview && existingReview.verdict !== "pending"
            ? existingReview
            : undefined
        }
      />
    </div>
  );
}
