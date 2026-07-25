import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_MESSAGES_PER_WINDOW,
} from "../shared/limits";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";
import { allowParticipantMessage } from "../worker/rate-limit";

describe("allowParticipantMessage", () => {
  it("allows up to the window max then rejects", () => {
    const store = new Map();
    const start = 1_000;
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW; i += 1) {
      expect(allowParticipantMessage(store, "p1", start)).toBe(true);
    }
    expect(allowParticipantMessage(store, "p1", start + 10)).toBe(false);
    // New window resets.
    expect(
      allowParticipantMessage(store, "p1", start + 1_000),
    ).toBe(true);
  });
});

describe("room input boundaries", () => {
  it("returns typed invalid_json for malformed frames and stays alive", async () => {
    const roomId = "bbbb9010";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Boundary");

    const err = waitForError(socket, "invalid_json");
    socket.send("{not-json");
    await err;

    // Room still accepts a valid cursor after the bad frame.
    socket.send(
      JSON.stringify({
        type: "cursor",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        x: 1,
        y: 2,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    socket.close(1000, "done");
  });

  it("returns typed unsupported_type for unknown message types", async () => {
    const roomId = "bbbb9011";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Boundary");

    const err = waitForError(socket, "unsupported_type");
    socket.send(
      JSON.stringify({
        type: "laser:pointer",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    await err;
    socket.close(1000, "done");
  });

  it("returns typed payload_too_large for oversized frames", async () => {
    const roomId = "bbbb9012";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Boundary");

    const err = waitForError(socket, "payload_too_large");
    socket.send("x".repeat(MAX_CLIENT_MESSAGE_BYTES + 1));
    await err;
    socket.close(1000, "done");
  });

  it("rejects Unicode frames within JS length but over UTF-8 byte cap", async () => {
    const roomId = "bbbb9020";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Unicode");

    // 😀 is 2 UTF-16 code units but 4 UTF-8 bytes → length 16384, bytes 32768.
    const frame = "😀".repeat(8192);
    expect(frame.length).toBe(MAX_CLIENT_MESSAGE_BYTES);
    expect(new TextEncoder().encode(frame).byteLength).toBeGreaterThan(
      MAX_CLIENT_MESSAGE_BYTES,
    );

    const err = waitForError(socket, "payload_too_large");
    socket.send(frame);
    await err;
    socket.close(1000, "done");
  });

  it("returns typed rate_limited after the per-participant frame budget", async () => {
    const roomId = "bbbb9013";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Boundary");

    const err = waitForError(socket, "rate_limited");
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW + 1; i += 1) {
      socket.send(
        JSON.stringify({
          type: "cursor",
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          x: i,
          y: i,
        }),
      );
    }
    await err;
    socket.close(1000, "done");
  });

  it("rate-limits a joined socket flooding malformed frames", async () => {
    const roomId = "bbbb9021";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Flood-JSON");

    const err = waitForError(socket, "rate_limited");
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW + 1; i += 1) {
      socket.send("{not-json");
    }
    await err;
    socket.close(1000, "done");
  });

  it("rate-limits a joined socket flooding repeated join frames", async () => {
    const roomId = "bbbb9022";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Flood-Join");

    const err = waitForError(socket, "rate_limited");
    const joinFrame = JSON.stringify({
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      displayName: "Flood-Join",
    });
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW + 1; i += 1) {
      socket.send(joinFrame);
    }
    await err;
    socket.close(1000, "done");
  });

  it("serializes rapid undo/redo without corrupting sequence or redo", async () => {
    const roomId = "bbbb9014";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Rapid");

    await completeStroke(socket, roomId, "a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    await completeStroke(socket, roomId, "b", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);

    const changes: Extract<ServerMessage, { type: "history:changed" }>[] = [];
    const collect = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "history:changed") {
        changes.push(message);
      }
    };
    socket.addEventListener("message", collect);

    socket.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "history:redo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );

    await waitUntil(() => changes.length >= 3);
    socket.removeEventListener("message", collect);

    expect(changes.map((m) => m.operations.map((op) => op.strokeId).join(","))).toEqual([
      "a",
      "",
      "a",
    ]);
    const last = changes[changes.length - 1]!;
    expect(last.sequenceHead).toBe(2);
    expect(last.canUndo).toBe(true);
    expect(last.canRedo).toBe(true);

    socket.close(1000, "done");
  });

  it("clears live state and alarms when the last participant leaves", async () => {
    const roomId = "bbbb9015";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Solo");

    socket.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "live-1",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 10, y: 10 },
      }),
    );
    await waitUntil(async () => {
      const head = await fetchDurableHead(roomId);
      return head.liveStrokeCount === 1 && head.pendingExpiryCount === 1;
    });

    const before = await fetchDurableHead(roomId);
    expect(before.alarmScheduled).toBe(true);

    socket.close(1000, "last-out");
    await waitUntil(async () => {
      const head = await fetchDurableHead(roomId);
      return (
        head.liveStrokeCount === 0 &&
        head.pendingExpiryCount === 0 &&
        head.alarmScheduled === false &&
        head.rateLimitEntries === 0
      );
    });

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM live_stroke_expiry`)
          .one(),
      ).toEqual({ n: 0 });
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});

async function fetchDurableHead(roomId: string): Promise<{
  liveStrokeCount: number;
  pendingExpiryCount: number;
  alarmScheduled: boolean;
  rateLimitEntries: number;
}> {
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const response = await stub.fetch(new Request("https://room/test/durable-head"));
  return (await response.json()) as {
    liveStrokeCount: number;
    pendingExpiryCount: number;
    alarmScheduled: boolean;
    rateLimitEntries: number;
  };
}

async function openRoomSocket(roomId: string): Promise<WebSocket> {
  const response = await exports.default.fetch(
    new Request(`https://example.com/ws?room=${roomId}`, {
      headers: { Upgrade: "websocket" },
    }),
    env,
    {} as ExecutionContext,
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).toBeTruthy();
  socket!.accept();
  return socket!;
}

async function joinAndDrain(
  socket: WebSocket,
  roomId: string,
  displayName: string,
): Promise<void> {
  const welcome = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "welcome" }> =>
      message.type === "welcome",
  );
  const sync = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
      message.type === "sync_state",
  );
  socket.send(
    JSON.stringify({
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      displayName,
    }),
  );
  await welcome;
  await sync;
}

async function completeStroke(
  socket: WebSocket,
  roomId: string,
  strokeId: string,
  points: { x: number; y: number }[],
): Promise<void> {
  const first = points[0]!;
  const rest = points.slice(1);
  const committed = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "operation:committed" }> =>
      message.type === "operation:committed" &&
      message.operation.strokeId === strokeId,
  );
  socket.send(
    JSON.stringify({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
      tool: "brush",
      color: "#0f6a5a",
      width: 4,
      point: first,
    }),
  );
  if (rest.length > 0) {
    socket.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        points: rest,
      }),
    );
  }
  socket.send(
    JSON.stringify({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
    }),
  );
  await committed;
}

function waitForError(socket: WebSocket, code: string): Promise<ServerMessage> {
  return waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "error" }> =>
      message.type === "error" && message.code === code,
  );
}

function waitForMessage<T extends ServerMessage>(
  socket: WebSocket,
  match: (message: ServerMessage) => message is T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for message"));
    }, 5_000);
    const onMessage = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message && match(message)) {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(message);
      }
    };
    socket.addEventListener("message", onMessage);
  });
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitUntil timed out");
}

function parseServer(event: MessageEvent): ServerMessage | null {
  if (typeof event.data !== "string") {
    return null;
  }
  try {
    return JSON.parse(event.data) as ServerMessage;
  } catch {
    return null;
  }
}
