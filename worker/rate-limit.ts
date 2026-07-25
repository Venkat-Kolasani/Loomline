/**
 * Fixed-window per-participant message-frame rate limiter (in-memory).
 * Resets on Durable Object eviction — acceptable; limit is anti-abuse, not auth.
 */

import {
  MAX_MESSAGES_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
} from "../shared/limits";

export interface RateLimitState {
  count: number;
  windowStart: number;
}

export function allowParticipantMessage(
  store: Map<string, RateLimitState>,
  participantId: string,
  now: number,
  maxPerWindow: number = MAX_MESSAGES_PER_WINDOW,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): boolean {
  let entry = store.get(participantId);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { count: 0, windowStart: now };
    store.set(participantId, entry);
  }
  entry.count += 1;
  return entry.count <= maxPerWindow;
}

/** Test-only override so integration floods stay within one window under load. */
let testMaxMessagesPerWindow: number | null = null;

export function setTestMaxMessagesPerWindow(max: number | null): void {
  testMaxMessagesPerWindow = max;
}

export function effectiveMaxMessagesPerWindow(): number {
  return testMaxMessagesPerWindow ?? MAX_MESSAGES_PER_WINDOW;
}
