/**
 * Event Bus — Observer Pattern with Type-Safe Dispatch
 *
 * Functorial structure: EventType → Set<Handler>
 * emit is a natural transformation: Event → IO ()
 *
 * Key properties:
 *   - FIFO handler ordering within each event type
 *   - Error isolation: one handler failing doesn't block others
 *   - Async handlers are awaited before emit resolves
 */

import type { EventMap, EventType, EventHandler, Unsubscribe } from "./types";

type AnyHandler = (event: unknown) => Promise<void> | void;

export class EventBus {
  private handlers = new Map<string, AnyHandler[]>();

  on<K extends EventType>(
    type: K,
    handler: EventHandler<K>,
  ): Unsubscribe {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(type, list);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return; // idempotent
      unsubscribed = true;
      const current = this.handlers.get(type);
      if (current) {
        const idx = current.indexOf(handler as AnyHandler);
        if (idx !== -1) current.splice(idx, 1);
      }
    };
  }

  once<K extends EventType>(
    type: K,
    handler: EventHandler<K>,
  ): Unsubscribe {
    const unsub = this.on(type, ((event: EventMap[K]) => {
      unsub();
      return handler(event);
    }) as EventHandler<K>);
    return unsub;
  }

  async emit<K extends EventType>(
    type: K,
    event: EventMap[K],
  ): Promise<void> {
    const list = this.handlers.get(type);
    if (!list) return;

    // Copy to avoid mutation during iteration
    for (const handler of [...list]) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[EventBus] Handler failed for "${type}":`, error);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  handlerCount(type?: EventType): number {
    if (type) {
      return this.handlers.get(type)?.length ?? 0;
    }
    let total = 0;
    for (const list of this.handlers.values()) {
      total += list.length;
    }
    return total;
  }
}
