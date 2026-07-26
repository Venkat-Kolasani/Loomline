/**
 * Documented input-boundary limits for Loomline WebSocket frames.
 * Valid protocol traffic is not rate-limited; the window only caps abuse floods.
 */

/** Reject raw text frames larger than this many UTF-8 bytes before JSON.parse. */
export const MAX_CLIENT_MESSAGE_BYTES = 16_384;

/**
 * Per-participant sliding window for **abuse frames only** (binary, oversized,
 * malformed JSON, parse failures). Valid join/stroke/cursor/history/ping
 * messages do not consume this budget.
 */
export const MAX_MESSAGES_PER_WINDOW = 120;
export const RATE_LIMIT_WINDOW_MS = 1_000;
