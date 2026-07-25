import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StrokePointBatcher } from "../client/src/net/stroke-batcher";

describe("StrokePointBatcher", () => {
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

  it("sends at most one batch per animation frame", async () => {
    const sent: { strokeId: string; points: { x: number; y: number }[] }[] =
      [];
    const batcher = new StrokePointBatcher({
      sendPoints: (strokeId, points) => {
        sent.push({ strokeId, points });
      },
    });

    batcher.enqueue("s1", [{ x: 1, y: 1 }]);
    batcher.enqueue("s1", [{ x: 2, y: 2 }]);
    batcher.enqueue("s1", [{ x: 3, y: 3 }]);

    expect(sent).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      strokeId: "s1",
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    });
  });

  it("flushes pending points before a new stroke or flushNow", async () => {
    const sent: { strokeId: string; count: number }[] = [];
    const batcher = new StrokePointBatcher({
      sendPoints: (strokeId, points) => {
        sent.push({ strokeId, count: points.length });
      },
    });

    batcher.enqueue("s1", [{ x: 1, y: 1 }]);
    batcher.flushNow();
    expect(sent).toEqual([{ strokeId: "s1", count: 1 }]);

    batcher.enqueue("s2", [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    batcher.flushNow();
    expect(sent).toEqual([
      { strokeId: "s1", count: 1 },
      { strokeId: "s2", count: 2 },
    ]);
  });
});
