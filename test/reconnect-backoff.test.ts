import { describe, expect, it } from "vitest";
import {
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  reconnectDelayMs,
} from "../client/src/net/reconnect-backoff";

describe("reconnectDelayMs", () => {
  it("grows exponentially with a hard cap and respects jitter bounds", () => {
    const noJitterLow = () => 0;
    const noJitterHigh = () => 1;

    expect(reconnectDelayMs(1, noJitterHigh)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1, noJitterLow)).toBe(
      Math.floor(RECONNECT_BASE_MS * 0.5),
    );
    expect(reconnectDelayMs(2, noJitterHigh)).toBe(RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(3, noJitterHigh)).toBe(RECONNECT_BASE_MS * 4);

    const large = reconnectDelayMs(20, noJitterHigh);
    expect(large).toBe(RECONNECT_MAX_MS);
  });
});
