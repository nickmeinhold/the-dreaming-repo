/**
 * Next.js Instrumentation — Runtime Dispatcher
 *
 * register() is invoked by Next in EVERY runtime (nodejs AND edge).
 * The node-only body lives in instrumentation-node.ts behind a dynamic
 * import so the edge bundle never evaluates pino/node:fs.
 * (A static import here crashed all requests in the standalone build.)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
