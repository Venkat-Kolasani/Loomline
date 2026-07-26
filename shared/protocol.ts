/**
 * Versioned Loomline WebSocket message schemas and boundary validation.
 * Invalid payloads return null so the Durable Object can send a typed error.
 */

import { PROTOCOL_VERSION, type Participant } from "./room";

export { PROTOCOL_VERSION };

export const MAX_STROKE_ID_LENGTH = 64;
export const MAX_POINTS_PER_MESSAGE = 64;
export const MAX_DISPLAY_NAME_LENGTH = 24;
export const MIN_STROKE_WIDTH = 1;
export const MAX_STROKE_WIDTH = 32;

export type DrawingTool = "brush" | "eraser";

/**
 * Normalized canvas coordinate: `x` is a fraction of the canvas width and `y`
 * a fraction of its height (`0`–`1` inside the box). Points are resolution and
 * aspect independent so a persisted operation replays correctly on any canvas
 * size. Values slightly outside `0`–`1` are legal (pointer capture past an
 * edge) and are validated only as finite numbers.
 */
export interface StrokePoint {
  x: number;
  y: number;
}

export type StrokeLivePhase = "start" | "points" | "end";

interface CommittedOperationBase {
  sequence: number;
  opId: string;
  participantId: string;
  createdAt: number;
}

/** One durable completed stroke, ordered by server-assigned `sequence`. */
export interface CommittedStrokeOperation extends CommittedOperationBase {
  kind: "stroke";
  strokeId: string;
  tool: DrawingTool;
  color: string;
  width: number;
  points: StrokePoint[];
}

/** Durable replay barrier: erase all pixels produced by earlier visible ops. */
export interface CommittedClearOperation extends CommittedOperationBase {
  kind: "clear";
}

export type CommittedOperation =
  | CommittedStrokeOperation
  | CommittedClearOperation;

export type ClientMessage =
  | {
      type: "join";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      displayName?: string;
    }
  | {
      type: "stroke:start";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      strokeId: string;
      tool: DrawingTool;
      color: string;
      width: number;
      point: StrokePoint;
    }
  | {
      type: "stroke:points";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      strokeId: string;
      points: StrokePoint[];
    }
  | {
      type: "stroke:end";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      strokeId: string;
      point?: StrokePoint;
    }
  | {
      type: "cursor";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      x: number;
      y: number;
    }
  | {
      type: "canvas:clear";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
    }
  | {
      type: "history:undo";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
    }
  | {
      type: "history:redo";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
    }
  | {
      type: "ping";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      /** Client `performance.now()` or `Date.now()` at send time. */
      clientTime: number;
    };

export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      participant: Participant;
    }
  | {
      type: "presence";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      participants: Participant[];
    }
  | {
      type: "stroke:live";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      participantId: string;
      strokeId: string;
      phase: StrokeLivePhase;
      tool?: DrawingTool;
      color?: string;
      width?: number;
      points: StrokePoint[];
    }
  | {
      type: "cursor";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      participantId: string;
      x: number;
      y: number;
    }
  | {
      type: "operation:committed";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      operation: CommittedOperation;
    }
  | {
      type: "sync_state";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      sequenceHead: number;
      operations: CommittedOperation[];
      canUndo: boolean;
      canRedo: boolean;
    }
  | {
      type: "history:changed";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      sequenceHead: number;
      operations: CommittedOperation[];
      canUndo: boolean;
      canRedo: boolean;
    }
  | {
      type: "pong";
      protocolVersion: typeof PROTOCOL_VERSION;
      roomId: string;
      clientTime: number;
      serverTime: number;
    }
  | {
      type: "error";
      protocolVersion: typeof PROTOCOL_VERSION;
      code: string;
      message: string;
    };

export type ParseClientResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: string; message: string };

type FieldOk<T> = { ok: true; value: T };
type FieldErr = { ok: false; code: string; message: string };
type FieldResult<T> = FieldOk<T> | FieldErr;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function parseClientMessage(value: unknown): ParseClientResult {
  if (typeof value !== "object" || value === null) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Message must be a JSON object.",
    };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Missing message type.",
    };
  }

  if (record.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "protocol_mismatch",
      message: `Expected protocolVersion ${PROTOCOL_VERSION}.`,
    };
  }

  if (typeof record.roomId !== "string") {
    return {
      ok: false,
      code: "invalid_payload",
      message: "roomId must be a string.",
    };
  }

  switch (record.type) {
    case "join":
      return parseJoin(record);
    case "stroke:start":
      return parseStrokeStart(record);
    case "stroke:points":
      return parseStrokePoints(record);
    case "stroke:end":
      return parseStrokeEnd(record);
    case "cursor":
      return parseCursor(record);
    case "canvas:clear":
    case "history:undo":
    case "history:redo":
      return {
        ok: true,
        message: {
          type: record.type,
          protocolVersion: PROTOCOL_VERSION,
          roomId: record.roomId as string,
        },
      };
    case "ping":
      return parsePing(record);
    default:
      return {
        ok: false,
        code: "unsupported_type",
        message: `Unsupported message type: ${record.type}`,
      };
  }
}

function parsePing(record: Record<string, unknown>): ParseClientResult {
  if (
    typeof record.clientTime !== "number" ||
    !Number.isFinite(record.clientTime)
  ) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "ping.clientTime must be a finite number.",
    };
  }
  return {
    ok: true,
    message: {
      type: "ping",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      clientTime: record.clientTime,
    },
  };
}

function parseJoin(
  record: Record<string, unknown>,
): ParseClientResult {
  if (
    record.displayName !== undefined &&
    typeof record.displayName !== "string"
  ) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "displayName must be a string when provided.",
    };
  }
  return {
    ok: true,
    message: {
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      displayName: record.displayName as string | undefined,
    },
  };
}

function parseStrokeStart(
  record: Record<string, unknown>,
): ParseClientResult {
  const strokeId = parseStrokeId(record.strokeId);
  if (!strokeId.ok) {
    return strokeId;
  }
  const tool = parseTool(record.tool);
  if (!tool.ok) {
    return tool;
  }
  if (typeof record.color !== "string" || !HEX_COLOR.test(record.color)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "color must be a #RRGGBB hex string.",
    };
  }
  const width = parseWidth(record.width);
  if (!width.ok) {
    return width;
  }
  const point = parsePoint(record.point);
  if (!point.ok) {
    return point;
  }
  return {
    ok: true,
    message: {
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      strokeId: strokeId.value,
      tool: tool.value,
      color: record.color,
      width: width.value,
      point: point.value,
    },
  };
}

function parseStrokePoints(
  record: Record<string, unknown>,
): ParseClientResult {
  const strokeId = parseStrokeId(record.strokeId);
  if (!strokeId.ok) {
    return strokeId;
  }
  const points = parsePointArray(record.points);
  if (!points.ok) {
    return points;
  }
  if (points.value.length === 0) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "points must be a non-empty array.",
    };
  }
  return {
    ok: true,
    message: {
      type: "stroke:points",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      strokeId: strokeId.value,
      points: points.value,
    },
  };
}

function parseStrokeEnd(
  record: Record<string, unknown>,
): ParseClientResult {
  const strokeId = parseStrokeId(record.strokeId);
  if (!strokeId.ok) {
    return strokeId;
  }
  if (record.point === undefined) {
    return {
      ok: true,
      message: {
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId: record.roomId as string,
        strokeId: strokeId.value,
      },
    };
  }
  const point = parsePoint(record.point);
  if (!point.ok) {
    return point;
  }
  return {
    ok: true,
    message: {
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      strokeId: strokeId.value,
      point: point.value,
    },
  };
}

function parseCursor(record: Record<string, unknown>): ParseClientResult {
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "cursor x and y must be finite numbers.",
    };
  }
  return {
    ok: true,
    message: {
      type: "cursor",
      protocolVersion: PROTOCOL_VERSION,
      roomId: record.roomId as string,
      x: record.x,
      y: record.y,
    },
  };
}

function parseStrokeId(value: unknown): FieldResult<string> {
  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "strokeId must be a non-empty string.",
    };
  }
  if (value.length > MAX_STROKE_ID_LENGTH) {
    return {
      ok: false,
      code: "invalid_payload",
      message: `strokeId must be at most ${MAX_STROKE_ID_LENGTH} characters.`,
    };
  }
  return { ok: true, value };
}

function parseTool(value: unknown): FieldResult<DrawingTool> {
  if (value === "brush" || value === "eraser") {
    return { ok: true, value };
  }
  return {
    ok: false,
    code: "invalid_payload",
    message: 'tool must be "brush" or "eraser".',
  };
}

function parseWidth(value: unknown): FieldResult<number> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_STROKE_WIDTH ||
    value > MAX_STROKE_WIDTH
  ) {
    return {
      ok: false,
      code: "invalid_payload",
      message: `width must be an integer from ${MIN_STROKE_WIDTH} to ${MAX_STROKE_WIDTH}.`,
    };
  }
  return { ok: true, value };
}

function parsePoint(value: unknown): FieldResult<StrokePoint> {
  if (typeof value !== "object" || value === null) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "point must be an object with x and y.",
    };
  }
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "point x and y must be finite numbers.",
    };
  }
  return { ok: true, value: { x: record.x, y: record.y } };
}

function parsePointArray(value: unknown): FieldResult<StrokePoint[]> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "points must be an array.",
    };
  }
  if (value.length > MAX_POINTS_PER_MESSAGE) {
    return {
      ok: false,
      code: "invalid_payload",
      message: `points must contain at most ${MAX_POINTS_PER_MESSAGE} entries.`,
    };
  }
  const points: StrokePoint[] = [];
  for (const entry of value) {
    const point = parsePoint(entry);
    if (!point.ok) {
      return point;
    }
    points.push(point.value);
  }
  return { ok: true, value: points };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
