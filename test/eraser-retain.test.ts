import { describe, expect, it } from "vitest";
import { retainProvisionalEraser } from "../client/src/canvas/eraser-retain";
import { RemoteStrokeStore } from "../client/src/canvas/remote-strokes";
import type { ServerMessage } from "../shared/protocol";

function live(
  partial: Omit<Extract<ServerMessage, { type: "stroke:live" }>, "v" | "type">,
): Extract<ServerMessage, { type: "stroke:live" }> {
  return { v: 1, type: "stroke:live", ...partial };
}

describe("retainProvisionalEraser", () => {
  it("keeps provisional when committed has fewer points", () => {
    expect(retainProvisionalEraser(5, 3)).toBe(true);
    expect(retainProvisionalEraser(5, 5)).toBe(false);
    expect(retainProvisionalEraser(5, 6)).toBe(false);
  });
});

describe("RemoteStrokeStore short-commit retain", () => {
  it("appends end-phase points onto provisional eraser", () => {
    const store = new RemoteStrokeStore();
    store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "e1",
        phase: "start",
        tool: "eraser",
        color: "#000",
        width: 10,
        points: [{ x: 0, y: 0 }],
      }),
    );
    store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "e1",
        phase: "end",
        points: [{ x: 9, y: 9 }],
      }),
    );
    expect(store.getActiveStrokes()[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ]);
  });

  it("keeps eraser when committed point count is shorter", () => {
    const store = new RemoteStrokeStore();
    store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "e1",
        phase: "start",
        tool: "eraser",
        color: "#000",
        width: 10,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
    );
    const kept = store.removeStroke("p1", "e1", 2);
    expect(kept.committedDirty).toBe(false);
    expect(store.getActiveStrokes()).toHaveLength(1);

    const dropped = store.removeStroke("p1", "e1", 3);
    expect(dropped.committedDirty).toBe(true);
    expect(store.getActiveStrokes()).toHaveLength(0);
  });
});
