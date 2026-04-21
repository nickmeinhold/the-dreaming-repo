/**
 * Journal Event Types — Discriminated Union
 *
 * Each event type maps to a payload shape. The EventMap
 * provides compile-time safety for subscribe/emit.
 */

export interface EventMap {
  "paper.submitted": { paperId: string };
  "paper.transitioned": { paperId: string; from: string; to: string };
  "review.submitted": { paperId: string; reviewerId: number };
  "note.added": { paperId: string; noteId: number };
}

export type EventType = keyof EventMap;
export type EventHandler<K extends EventType> = (
  event: EventMap[K],
) => Promise<void> | void;
export type Unsubscribe = () => void;
