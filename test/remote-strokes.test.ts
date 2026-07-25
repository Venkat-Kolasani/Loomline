import { describe, expect, it } from "vitest";
import { RemoteStrokeStore } from "../client/src/canvas/remote-strokes";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

function live(
  partial: Omit<
    Extract<ServerMessage, { type: "stroke:live" }>,
    "protocolVersion" | "type"
  >,
): Extract<ServerMessage, { type: "stroke:live" }> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "stroke:live",
    ...partial,
  };
}

describe("RemoteStrokeStore eraser provisional", () => {
  it("keeps eraser after end until removeStroke (no hole flash)", () => {
    const store = new RemoteStrokeStore();
    const start = store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "e1",
        phase: "start",
        tool: "eraser",
        color: "#000",
        width: 10,
        points: [{ x: 1, y: 1 }],
      }),
    );
    expect(start.committedDirty).toBe(true);
    expect(store.getActiveStrokes()).toHaveLength(1);

    const ended = store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "e1",
        phase: "end",
        points: [],
      }),
    );
    expect(ended.committedDirty).toBe(false);
    expect(store.getActiveStrokes()).toHaveLength(1);

    const removed = store.removeStroke("p1", "e1");
    expect(removed.committedDirty).toBe(true);
    expect(store.getActiveStrokes()).toHaveLength(0);
  });

  it("drops brush on end and marks live dirty only", () => {
    const store = new RemoteStrokeStore();
    store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "b1",
        phase: "start",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        points: [{ x: 0, y: 0 }],
      }),
    );
    const ended = store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "b1",
        phase: "end",
        points: [],
      }),
    );
    expect(ended.liveDirty).toBe(true);
    expect(ended.committedDirty).toBe(false);
    expect(store.getActiveStrokes()).toHaveLength(0);
  });

  it("preserves an active eraser across a committed history rebuild", () => {
    const store = new RemoteStrokeStore();
    store.applyLive(
      live({
        roomId: "abcd1234",
        participantId: "p1",
        strokeId: "still-active",
        phase: "start",
        tool: "eraser",
        color: "#000000",
        width: 10,
        points: [{ x: 1, y: 1 }],
      }),
    );

    expect(store.clearProvisionalErasers()).toBe(false);
    expect(store.getActiveStrokes()).toHaveLength(1);
  });
});
