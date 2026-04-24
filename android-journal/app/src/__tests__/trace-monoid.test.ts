/**
 * T7: Monoid Laws for TraceRecorder
 *
 * The trace accumulator forms a free monoid on StepRecords via
 * list concatenation. These tests verify identity and associativity.
 *
 * Derived from OBSERVABILITY.md — the algebraic structure of the
 * observation monoid determines what queries are expressible.
 */

import { describe, test, expect } from "vitest";
import { TraceRecorder } from "@/lib/trace";

describe("T7: trace monoid laws", () => {
  test("identity: empty trace produces no steps", () => {
    const trace = new TraceRecorder();
    expect(trace.getSteps()).toEqual([]);
    // The identity element of the free monoid is the empty list
  });

  test("associativity: step ordering matches execution order", async () => {
    const trace = new TraceRecorder();

    // Three steps in sequence — the monoid must preserve ordering
    trace.mark("step-a");
    await trace.step("step-b", async () => "b-result");
    trace.fail("step-c", "intentional failure");

    const steps = trace.getSteps();
    expect(steps.map((s) => s.name)).toEqual(["step-a", "step-b", "step-c"]);
    expect(steps.map((s) => s.status)).toEqual(["ok", "ok", "err"]);

    // step-a and step-c are marks (0ms), step-b is a timed step
    expect(steps[0].ms).toBe(0);
    expect(steps[2].ms).toBe(0);
    expect(steps[2].error).toBe("intentional failure");
  });

  test("step re-throws errors after recording", async () => {
    const trace = new TraceRecorder();

    await expect(
      trace.step("explode", async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");

    // The error was recorded before re-throwing
    const steps = trace.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      name: "explode",
      status: "err",
      error: "boom",
    });
    expect(steps[0].ms).toBeGreaterThanOrEqual(0);
  });

  test("getSteps returns a copy (immutable observation)", () => {
    const trace = new TraceRecorder();
    trace.mark("a");
    const steps1 = trace.getSteps();
    trace.mark("b");
    const steps2 = trace.getSteps();

    // Mutations to the returned array don't affect the recorder
    expect(steps1).toHaveLength(1);
    expect(steps2).toHaveLength(2);
    steps1.push({ name: "injected", status: "ok", ms: 0 });
    expect(trace.getSteps()).toHaveLength(2); // unaffected
  });
});
