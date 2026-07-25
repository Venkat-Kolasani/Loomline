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
        protocolVersion: 1,
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

  it("accepts history:undo and history:redo", () => {
    for (const type of ["history:undo", "history:redo"] as const) {
      const result = parseClientMessage({
        type,
        protocolVersion: PROTOCOL_VERSION,
        roomId: "abcd1234",
      });
      expect(result).toEqual({
        ok: true,
        message: {
          type,
          protocolVersion: 1,
          roomId: "abcd1234",
        },
      });
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
        protocolVersion: 1,
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
