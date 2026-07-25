/**
 * Exponential reconnect delay with jitter and a hard cap.
 * attempt is 1-based (first reconnect → attempt 1).
 */

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 15_000;

export function reconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const cappedAttempt = Math.max(1, Math.min(attempt, 16));
  const exp = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** (cappedAttempt - 1),
  );
  // Full jitter in [0.5, 1.0] × exp so clients do not stampede.
  const jitter = 0.5 + random() * 0.5;
  return Math.floor(exp * jitter);
}
