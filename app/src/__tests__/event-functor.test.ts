/**
 * Event Bus — Observer Pattern + Functorial Dispatch
 *
 * CATEGORY THEORY:
 *   The event bus defines a functor F: EventType → Set(Handler).
 *   emit is a natural transformation η: Event → IO(), dispatching
 *   each event to its handler set with error isolation.
 *
 * DESIGN PATTERNS (GoF):
 *   Observer — subscribe/emit with decoupled publishers and subscribers
 *
 * Properties tested:
 *   - Subscription semantics (on, once, unsubscribe)
 *   - FIFO handler ordering
 *   - Error isolation (fault tolerance)
 *   - Type discrimination (handlers only receive their event type)
 *   - Neutral element: emit with no handlers is a no-op
 */

import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@/lib/events/bus";

// ═══════════════════════════════════════════════════════════
//  SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

describe("Subscription", () => {
  it("subscribe and receive matching events", async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("paper.submitted", (e) => {
      received.push(e.paperId);
    });

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(received).toEqual(["2026-001"]);
  });

  it("don't receive non-matching event types", async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("paper.submitted", (e) => {
      received.push(e.paperId);
    });

    await bus.emit("review.submitted", { paperId: "2026-001", reviewerId: 1 });
    expect(received).toEqual([]);
  });

  it("multiple handlers for same event type all fire", async () => {
    const bus = new EventBus();
    let count = 0;

    bus.on("paper.submitted", () => { count++; });
    bus.on("paper.submitted", () => { count++; });
    bus.on("paper.submitted", () => { count++; });

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(count).toBe(3);
  });

  it("handlers execute in registration order (FIFO)", async () => {
    const bus = new EventBus();
    const order: string[] = [];

    bus.on("paper.submitted", () => { order.push("first"); });
    bus.on("paper.submitted", () => { order.push("second"); });
    bus.on("paper.submitted", () => { order.push("third"); });

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(order).toEqual(["first", "second", "third"]);
  });
});

// ═══════════════════════════════════════════════════════════
//  UNSUBSCRIBE
// ═══════════════════════════════════════════════════════════

describe("Unsubscribe", () => {
  it("unsubscribe removes handler", async () => {
    const bus = new EventBus();
    let count = 0;

    const unsub = bus.on("paper.submitted", () => { count++; });
    unsub();

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(count).toBe(0);
  });

  it("unsubscribed handler doesn't receive subsequent events", async () => {
    const bus = new EventBus();
    const received: string[] = [];

    const unsub = bus.on("paper.submitted", (e) => {
      received.push(e.paperId);
    });

    await bus.emit("paper.submitted", { paperId: "001" });
    unsub();
    await bus.emit("paper.submitted", { paperId: "002" });

    expect(received).toEqual(["001"]);
  });

  it("double unsubscribe is idempotent (no error)", () => {
    const bus = new EventBus();
    const unsub = bus.on("paper.submitted", () => {});

    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
//  ONCE
// ═══════════════════════════════════════════════════════════

describe("Once", () => {
  it("once() fires exactly once then auto-unsubscribes", async () => {
    const bus = new EventBus();
    let count = 0;

    bus.once("paper.submitted", () => { count++; });

    await bus.emit("paper.submitted", { paperId: "001" });
    await bus.emit("paper.submitted", { paperId: "002" });

    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
//  ERROR ISOLATION
// ═══════════════════════════════════════════════════════════

describe("Error Isolation", () => {
  it("error in one handler doesn't prevent others from running", async () => {
    const bus = new EventBus();
    const results: string[] = [];

    bus.on("paper.submitted", () => { results.push("before"); });
    bus.on("paper.submitted", () => { throw new Error("handler crash"); });
    bus.on("paper.submitted", () => { results.push("after"); });

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(results).toEqual(["before", "after"]);
  });
});

// ═══════════════════════════════════════════════════════════
//  DISPATCH SEMANTICS
// ═══════════════════════════════════════════════════════════

describe("Dispatch Semantics", () => {
  it("async handlers are awaited before emit resolves", async () => {
    const bus = new EventBus();
    let resolved = false;

    bus.on("paper.submitted", async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });

    await bus.emit("paper.submitted", { paperId: "2026-001" });
    expect(resolved).toBe(true);
  });

  it("emit with no handlers is a no-op (neutral element)", async () => {
    const bus = new EventBus();
    // Should not throw
    await expect(
      bus.emit("paper.submitted", { paperId: "2026-001" }),
    ).resolves.toBeUndefined();
  });

  it("handler receives correct event data (type + payload)", async () => {
    const bus = new EventBus();
    let received: { paperId: string; from: string; to: string } | null = null;

    bus.on("paper.transitioned", (e) => {
      received = e;
    });

    await bus.emit("paper.transitioned", {
      paperId: "2026-001",
      from: "submitted",
      to: "under-review",
    });

    expect(received).toEqual({
      paperId: "2026-001",
      from: "submitted",
      to: "under-review",
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  TYPE DISCRIMINATION
// ═══════════════════════════════════════════════════════════

describe("Type Discrimination", () => {
  it("handler only receives events of its registered type", async () => {
    const bus = new EventBus();
    const submitted: string[] = [];
    const transitioned: string[] = [];

    bus.on("paper.submitted", (e) => { submitted.push(e.paperId); });
    bus.on("paper.transitioned", (e) => { transitioned.push(e.paperId); });

    await bus.emit("paper.submitted", { paperId: "001" });
    await bus.emit("paper.transitioned", { paperId: "002", from: "a", to: "b" });

    expect(submitted).toEqual(["001"]);
    expect(transitioned).toEqual(["002"]);
  });
});

// ═══════════════════════════════════════════════════════════
//  MANAGEMENT
// ═══════════════════════════════════════════════════════════

describe("Management", () => {
  it("clear() removes all handlers", async () => {
    const bus = new EventBus();
    let count = 0;

    bus.on("paper.submitted", () => { count++; });
    bus.on("review.submitted", () => { count++; });
    bus.clear();

    await bus.emit("paper.submitted", { paperId: "001" });
    await bus.emit("review.submitted", { paperId: "001", reviewerId: 1 });
    expect(count).toBe(0);
  });

  it("multiple emit calls dispatch independently", async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("paper.submitted", (e) => { received.push(e.paperId); });

    await bus.emit("paper.submitted", { paperId: "001" });
    await bus.emit("paper.submitted", { paperId: "002" });

    expect(received).toEqual(["001", "002"]);
  });

  it("handlerCount() reflects current subscriptions", () => {
    const bus = new EventBus();

    const unsub1 = bus.on("paper.submitted", () => {});
    bus.on("paper.submitted", () => {});
    bus.on("review.submitted", () => {});

    expect(bus.handlerCount("paper.submitted")).toBe(2);
    expect(bus.handlerCount("review.submitted")).toBe(1);
    expect(bus.handlerCount()).toBe(3);

    unsub1();
    expect(bus.handlerCount("paper.submitted")).toBe(1);
    expect(bus.handlerCount()).toBe(2);
  });
});
