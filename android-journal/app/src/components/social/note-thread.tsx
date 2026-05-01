"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addNote } from "@/lib/actions/social";
import Link from "next/link";

interface Note {
  id: number;
  content: string;
  createdAt: string;
  user: { displayName: string; githubLogin: string; avatarUrl: string | null };
  replies: Note[];
}

interface Props {
  paperId: string;
  notes: Note[];
  isAuthenticated: boolean;
}

export function NoteThread({ paperId, notes, isAuthenticated }: Props) {
  return (
    <section data-testid="notes-section">
      <h2 className="mb-4 font-serif text-lg font-semibold">
        Notes ({countNotes(notes)})
      </h2>

      {isAuthenticated && (
        <NoteComposer paperId={paperId} />
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-muted">
          No notes yet.{" "}
          {isAuthenticated
            ? "Leave the first one."
            : "Sign in to leave a note."}
        </p>
      ) : (
        <div className="space-y-4" data-testid="notes-list">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} paperId={paperId} isAuthenticated={isAuthenticated} depth={0} />
          ))}
        </div>
      )}
    </section>
  );
}

function NoteCard({
  note,
  paperId,
  isAuthenticated,
  depth,
}: {
  note: Note;
  paperId: string;
  isAuthenticated: boolean;
  depth: number;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <div className={depth > 0 ? "ml-6 border-l border-border pl-4" : ""} data-testid="note-card" data-note-id={note.id}>
      <div className="rounded-md border border-border p-4">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          {note.user.avatarUrl && (
            <img src={note.user.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
          )}
          <Link
            href={`/users/${note.user.githubLogin}`}
            className="font-medium text-foreground hover:text-link"
            data-testid="note-author"
          >
            {note.user.displayName}
          </Link>
          <span data-testid="note-date">{new Date(note.createdAt).toLocaleDateString("en-AU")}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="note-content">{note.content}</p>
        {isAuthenticated && depth < 3 && (
          <button
            onClick={() => setReplying(!replying)}
            className="mt-2 text-xs text-muted hover:text-foreground"
            data-testid="note-reply-btn"
          >
            {replying ? "Cancel" : "Reply"}
          </button>
        )}
      </div>

      {replying && (
        <div className="mt-2 ml-6">
          <NoteComposer paperId={paperId} parentId={note.id} onDone={() => setReplying(false)} />
        </div>
      )}

      {note.replies.length > 0 && (
        <div className="mt-2 space-y-2" data-testid="note-replies">
          {note.replies.map((reply) => (
            <NoteCard
              key={reply.id}
              note={reply}
              paperId={paperId}
              isAuthenticated={isAuthenticated}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteComposer({
  paperId,
  parentId,
  onDone,
}: {
  paperId: string;
  parentId?: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);

    const result = await addNote(paperId, content, parentId);
    if (result.success) {
      setContent("");
      router.refresh();
      onDone?.();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4" data-testid="note-composer">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        data-testid="note-textarea"
        placeholder={parentId ? "Write a reply..." : "Leave a note — questions, connections, follow-up ideas..."}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-link focus:outline-none focus:ring-1 focus:ring-link"
      />
      <button
        type="submit"
        disabled={loading || !content.trim()}
        data-testid="note-submit"
        className="mt-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? "Posting..." : parentId ? "Reply" : "Post Note"}
      </button>
    </form>
  );
}

function countNotes(notes: Note[]): number {
  return notes.reduce((acc, n) => acc + 1 + countNotes(n.replies), 0);
}
