import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LiveStrokeTransport } from "../client/src/net/live-stroke-transport";

describe("LiveStrokeTransport connecting race", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        return setTimeout(() => cb(performance.now()), 0) as unknown as number;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suppresses points and end when stroke:start was not accepted", async () => {
    let ready = false;
    const sent: string[] = [];
    const transport = new LiveStrokeTransport({
      isReady: () => ready,
      sendStrokeStart: (event) => {
        sent.push(`start:${event.strokeId}`);
      },
      sendStrokePoints: (strokeId, points) => {
        sent.push(`points:${strokeId}:${points.length}`);
      },
      sendStrokeEnd: (strokeId) => {
        sent.push(`end:${strokeId}`);
      },
    });

    const strokeId = "stroke-before-welcome";
    transport.onStrokeStart({
      strokeId,
      tool: "brush",
      color: "#0f6a5a",
      width: 4,
      point: { x: 1, y: 1 },
    });

    // Welcome arrives mid-stroke; later batches must not orphan to the server.
    ready = true;
    transport.onStrokePoints(strokeId, [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transport.onStrokeEnd(strokeId)).toBe(false);

    expect(sent).toEqual([]);
  });

  it("sends start/points/end for strokes begun after ready", async () => {
    const sent: string[] = [];
    const transport = new LiveStrokeTransport({
      isReady: () => true,
      sendStrokeStart: (event) => {
        sent.push(`start:${event.strokeId}`);
      },
      sendStrokePoints: (strokeId, points) => {
        sent.push(`points:${strokeId}:${points.length}`);
      },
      sendStrokeEnd: (strokeId) => {
        sent.push(`end:${strokeId}`);
      },
    });

    transport.onStrokeStart({
      strokeId: "s1",
      tool: "brush",
      color: "#0f6a5a",
      width: 4,
      point: { x: 1, y: 1 },
    });
    transport.onStrokePoints("s1", [{ x: 2, y: 2 }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transport.onStrokeEnd("s1")).toBe(true);

    expect(sent).toEqual(["start:s1", "points:s1:1", "end:s1"]);
  });
});
