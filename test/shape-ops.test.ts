import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type ShapeKind,
  type ServerMessage,
} from "../shared/protocol";

describe("shape durable commits", () => {
  it.each([
    {
      kind: "line" as const,
      roomId: "line0001",
      shapeId: "shape-line",
      start: { x: 0.1, y: 0.2 },
      end: { x: 0.9, y: 0.8 },
    },
    {
      kind: "ellipse" as const,
      roomId: "ellip001",
      shapeId: "shape-ellipse",
      start: { x: 0.2, y: 0.25 },
      end: { x: 0.7, y: 0.75 },
    },
    {
      kind: "arrow" as const,
      roomId: "arrow001",
      shapeId: "shape-arrow",
      start: { x: 0.15, y: 0.5 },
      end: { x: 0.85, y: 0.5 },
    },
    {
      kind: "diamond" as const,
      roomId: "diamon01",
      shapeId: "shape-diamond",
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.8, y: 0.8 },
    },
    {
      kind: "triangle" as const,
      roomId: "triangl1",
      shapeId: "shape-triangle",
      start: { x: 0.25, y: 0.2 },
      end: { x: 0.75, y: 0.85 },
    },
  ])(
    "commits one sequenced $kind to both clients",
    async ({ kind, roomId, shapeId, start, end }) => {
      const socketA = await openRoomSocket(roomId);
      const socketB = await openRoomSocket(roomId);
      await joinAndDrain(socketA, roomId, "Artist-A");
      await joinAndDrain(socketB, roomId, "Artist-B");

      const onA = waitForShape(socketA, kind, shapeId);
      const onB = waitForShape(socketB, kind, shapeId);
      socketA.send(
        JSON.stringify({
          type: `shape:${kind}`,
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          shapeId,
          color: "#1d4ed8",
          width: 6,
          start,
          end,
        }),
      );
      const [committedA, committedB] = await Promise.all([onA, onB]);

      expect(committedA.operation.sequence).toBe(1);
      expect(committedA.operation).toMatchObject({
        kind,
        shapeId,
        color: "#1d4ed8",
        width: 6,
        start,
        end,
      });
      expect(committedB.operation).toEqual(committedA.operation);

      const late = await joinForSync(roomId, "Late");
      expect(late.sync.sequenceHead).toBe(1);
      expect(late.sync.operations).toHaveLength(1);
      expect(late.sync.operations[0]).toMatchObject({
        kind,
        shapeId,
      });

      socketA.close(1000, "done");
      socketB.close(1000, "done");
      late.socket.close(1000, "done");
    },
  );

  it("undoes a non-rect shape (line) on both clients", async () => {
    const roomId = "lineundo";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");

    const onA = waitForShape(socketA, "line", "shape-undo-line");
    const onB = waitForShape(socketB, "line", "shape-undo-line");
    socketA.send(
      JSON.stringify({
        type: "shape:line",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        shapeId: "shape-undo-line",
        color: "#0f6a5a",
        width: 4,
        start: { x: 0.2, y: 0.2 },
        end: { x: 0.8, y: 0.8 },
      }),
    );
    await Promise.all([onA, onB]);

    const undoOnA = waitForHistoryEmpty(socketA);
    const undoOnB = waitForHistoryEmpty(socketB);
    socketB.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    const [undoneA, undoneB] = await Promise.all([undoOnA, undoOnB]);
    expect(undoneA.operations).toEqual([]);
    expect(undoneB.canRedo).toBe(true);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });
});

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
  const sync = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
      message.type === "sync_state",
  );
  await joinAndWaitWelcome(socket, roomId, displayName);
  await sync;
}

async function joinForSync(
  roomId: string,
  displayName: string,
): Promise<{
  socket: WebSocket;
  sync: Extract<ServerMessage, { type: "sync_state" }>;
}> {
  const socket = await openRoomSocket(roomId);
  const sync = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
      message.type === "sync_state",
  );
  await joinAndWaitWelcome(socket, roomId, displayName);
  return { socket, sync: await sync };
}

async function joinAndWaitWelcome(
  socket: WebSocket,
  roomId: string,
  displayName: string,
): Promise<Extract<ServerMessage, { type: "welcome" }>> {
  const welcome = waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "welcome" }> =>
      message.type === "welcome",
  );
  socket.send(
    JSON.stringify({
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      displayName,
    }),
  );
  return welcome;
}

function waitForShape(
  socket: WebSocket,
  kind: ShapeKind,
  shapeId: string,
): Promise<Extract<ServerMessage, { type: "operation:committed" }>> {
  return waitForMessage(
    socket,
    (
      message,
    ): message is Extract<ServerMessage, { type: "operation:committed" }> =>
      message.type === "operation:committed" &&
      message.operation.kind === kind &&
      "shapeId" in message.operation &&
      message.operation.shapeId === shapeId,
  );
}

function waitForHistoryEmpty(
  socket: WebSocket,
): Promise<Extract<ServerMessage, { type: "history:changed" }>> {
  return waitForMessage(
    socket,
    (
      message,
    ): message is Extract<ServerMessage, { type: "history:changed" }> =>
      message.type === "history:changed" && message.operations.length === 0,
  );
}

function waitForMessage<T extends ServerMessage>(
  socket: WebSocket,
  predicate: (message: ServerMessage) => message is T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 5_000);

    function onMessage(event: MessageEvent): void {
      if (typeof event.data !== "string") {
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }

    socket.addEventListener("message", onMessage);
  });
}
