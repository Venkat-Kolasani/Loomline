/**
 * Documented input-boundary limits for Loomline WebSocket frames.
 * Sized to preserve normal rAF-batched drawing (≤1 points batch + cursor / frame).
 */

/** Reject raw text frames larger than this before JSON.parse. */
export const MAX_CLIENT_MESSAGE_BYTES = 16_384;

/**
 * Per-participant sliding window: max client messages per RATE_LIMIT_WINDOW_MS.
 * 120 ≈ one stroke:points + one cursor per frame at 60 Hz, plus headroom for
 * start/end/history. Intentional history actions are never debounced.
 */
export const MAX_MESSAGES_PER_WINDOW = 120;
export const RATE_LIMIT_WINDOW_MS = 1_000;
