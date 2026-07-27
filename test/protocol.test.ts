import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  MAX_POINTS_PER_MESSAGE,
} from "../shared/protocol";

describe("parseClientMessage", () => {
  it("accepts a valid join", () => {
    const result = parseClientMessage({
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      displayName: "Venkat",
    });
    expect(result).toEqual({
      ok: true,
      message: {
        type: "join",
        protocolVersion: PROTOCOL_VERSION,
        roomId: "abcd1234",
        displayName: "Venkat",
      },
    });
  });

  it("rejects wrong protocol version", () => {
    const result = parseClientMessage({
      type: "join",
      protocolVersion: 99,
      roomId: "abcd1234",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("protocol_mismatch");
    }
  });

  it("rejects unknown message types", () => {
    const result = parseClientMessage({
      type: "foo:bar",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_type");
    }
  });

  it("accepts canvas:clear, history:undo, and history:redo", () => {
    for (const type of [
      "canvas:clear",
      "history:undo",
      "history:redo",
    ] as const) {
      const result = parseClientMessage({
        type,
        protocolVersion: PROTOCOL_VERSION,
        roomId: "abcd1234",
      });
      expect(result).toEqual({
        ok: true,
        message: {
          type,
          protocolVersion: PROTOCOL_VERSION,
          roomId: "abcd1234",
        },
      });
    }
  });

  it("rejects malformed canvas:clear without a room id", () => {
    const result = parseClientMessage({
      type: "canvas:clear",
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_payload");
    }
  });

  it("accepts stroke:start with tool, color, width, and point", () => {
    const result = parseClientMessage({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
      tool: "brush",
      color: "#0f6a5a",
      width: 4,
      point: { x: 10, y: 20 },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects stroke:start with invalid color", () => {
    const result = parseClientMessage({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
      tool: "brush",
      color: "green",
      width: 4,
      point: { x: 10, y: 20 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_payload");
    }
  });

  it("rejects stroke:points with empty array", () => {
    const result = parseClientMessage({
      type: "stroke:points",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
      points: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects oversized points batches", () => {
    const points = Array.from({ length: MAX_POINTS_PER_MESSAGE + 1 }, (_, i) => ({
      x: i,
      y: i,
    }));
    const result = parseClientMessage({
      type: "stroke:points",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
      points,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts stroke:end with optional final point", () => {
    const withPoint = parseClientMessage({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
      point: { x: 1, y: 2 },
    });
    const withoutPoint = parseClientMessage({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      strokeId: "s1",
    });
    expect(withPoint.ok).toBe(true);
    expect(withoutPoint.ok).toBe(true);
  });

  it("accepts shape:rect with normalized corners", () => {
    const result = parseClientMessage({
      type: "shape:rect",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "rect-1",
      color: "#0f6a5a",
      width: 4,
      start: { x: 0.1, y: 0.2 },
      end: { x: 0.8, y: 0.9 },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        type: "shape:rect",
        protocolVersion: PROTOCOL_VERSION,
        roomId: "abcd1234",
        shapeId: "rect-1",
        color: "#0f6a5a",
        width: 4,
        start: { x: 0.1, y: 0.2 },
        end: { x: 0.8, y: 0.9 },
      },
    });
  });

  it("accepts shape:line with normalized endpoints", () => {
    const result = parseClientMessage({
      type: "shape:line",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "line-1",
      color: "#1d4ed8",
      width: 3,
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.9, y: 0.9 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("shape:line");
    }
  });

  it("accepts shape:ellipse with normalized bounding box", () => {
    const result = parseClientMessage({
      type: "shape:ellipse",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "ellipse-1",
      color: "#be123c",
      width: 4,
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.8, y: 0.7 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("shape:ellipse");
    }
  });

  it("accepts shape:arrow with normalized endpoints", () => {
    const result = parseClientMessage({
      type: "shape:arrow",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "arrow-1",
      color: "#b45309",
      width: 5,
      start: { x: 0.15, y: 0.5 },
      end: { x: 0.85, y: 0.5 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("shape:arrow");
    }
  });

  it("accepts shape:diamond with normalized bounding box", () => {
    const result = parseClientMessage({
      type: "shape:diamond",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "diamond-1",
      color: "#7c3aed",
      width: 4,
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.8, y: 0.8 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("shape:diamond");
    }
  });

  it("accepts shape:triangle with normalized bounding box", () => {
    const result = parseClientMessage({
      type: "shape:triangle",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "triangle-1",
      color: "#0f766e",
      width: 3,
      start: { x: 0.25, y: 0.15 },
      end: { x: 0.75, y: 0.85 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("shape:triangle");
    }
  });

  it("rejects shape:rect with invalid color", () => {
    const result = parseClientMessage({
      type: "shape:rect",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      shapeId: "rect-1",
      color: "teal",
      width: 4,
      start: { x: 0.1, y: 0.2 },
      end: { x: 0.8, y: 0.9 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_payload");
    }
  });

  it("accepts cursor messages", () => {
    const result = parseClientMessage({
      type: "cursor",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      x: 12.5,
      y: 40,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts ping with clientTime", () => {
    const result = parseClientMessage({
      type: "ping",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
      clientTime: 100.5,
    });
    expect(result).toEqual({
      ok: true,
      message: {
        type: "ping",
        protocolVersion: PROTOCOL_VERSION,
        roomId: "abcd1234",
        clientTime: 100.5,
      },
    });
  });

  it("rejects ping without clientTime", () => {
    const result = parseClientMessage({
      type: "ping",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "abcd1234",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects non-object payloads", () => {
    const result = parseClientMessage("join");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_payload");
    }
  });
});
