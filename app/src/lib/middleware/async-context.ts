/**
 * Async Context — Request-Scoped Storage
 *
 * AsyncLocalStorage threads correlation IDs and user identity
 * through the request lifecycle without explicit parameter passing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestStore {
  correlationId: string;
  userId: number | null;
}

export const requestStore = new AsyncLocalStorage<RequestStore>();

export function getCorrelationId(): string {
  return requestStore.getStore()?.correlationId ?? crypto.randomUUID();
}

export function getCurrentUserId(): number | null {
  return requestStore.getStore()?.userId ?? null;
}
