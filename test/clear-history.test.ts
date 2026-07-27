import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type CommittedOperation,
  type ServerMessage,
} from "../shared/protocol";

describe("global durable canvas clear", () => {
  it("fans out to two clients and persists for join and reconnect", async () => {
    const roomId = "clear001";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await completeStroke(socketA, roomId, "before-clear");

    const clearOnA = waitForCommittedKind(socketA, "clear");
    const clearOnB = waitForCommittedKind(socketB, "clear");
    sendClear(socketB, roomId);
    const [onA, onB] = await Promise.all([clearOnA, clearOnB]);

    expect(onA.operation.sequence).toBe(2);
    expect(onB.operation).toEqual(onA.operation);

    const firstJoin = await joinForSync(roomId, "Late-Join");
    expect(firstJoin.sync.sequenceHead).toBe(2);
    expect(firstJoin.sync.operations.map(operationLabel)).toEqual([
      "stroke:before-clear",
      "clear",
    ]);
    firstJoin.socket.close(1000, "simulate reconnect");

    const reconnect = await joinForSync(roomId, "Late-Join");
    expect(reconnect.sync.operations).toEqual(firstJoin.sync.operations);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
    reconnect.socket.close(1000, "done");
  });

  it("undo restores pre-clear strokes on both clients and redo clears again", async () => {
    const roomId = "clear002";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await completeStroke(socketA, roomId, "restored");
    const clearCommitted = waitForCommittedKind(socketA, "clear");
    sendClear(socketB, roomId);
    await clearCommitted;

    const undoOnA = waitForHistoryLabels(socketA, ["stroke:restored"]);
    const undoOnB = waitForHistoryLabels(socketB, ["stroke:restored"]);
    sendHistory(socketA, roomId, "history:undo");
    const [undoneA, undoneB] = await Promise.all([undoOnA, undoOnB]);
    expect(undoneA.canRedo).toBe(true);
    expect(undoneB.operations.map(operationLabel)).toEqual([
      "stroke:restored",
    ]);

    const redoOnA = waitForHistoryLabels(socketA, [
      "stroke:restored",
      "clear",
    ]);
    const redoOnB = waitForHistoryLabels(socketB, [
      "stroke:restored",
      "clear",
    ]);
    sendHistory(socketB, roomId, "history:redo");
    const [redoneA, redoneB] = await Promise.all([redoOnA, redoOnB]);
    expect(redoneA.canRedo).toBe(false);
    expect(redoneB.operations.map(operationLabel)).toEqual([
      "stroke:restored",
      "clear",
    ]);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("keeps an active stroke and sequences its completed op after clear", async () => {
    const roomId = "clear003";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Drawing");
    await joinAndDrain(socketB, roomId, "Clearing");
    await completeStroke(socketA, roomId, "old");

    const liveStarted = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "active",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "active",
        tool: "brush",
        color: "#be123c",
        width: 5,
        point: { x: 20, y: 20 },
      }),
    );
    await liveStarted;

    const clearCommitted = waitForCommittedKind(socketA, "clear");
    sendClear(socketB, roomId);
    const clear = await clearCommitted;
    expect(clear.operation.sequence).toBe(2);

    const activeCommitted = waitForMessage(
      socketB,
      (
        message,
      ): message is Extract<ServerMessage, { type: "operation:committed" }> =>
        message.type === "operation:committed" &&
        message.operation.kind === "stroke" &&
        message.operation.strokeId === "active",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "active",
        point: { x: 80, y: 80 },
      }),
    );
    const active = await activeCommitted;
    expect(active.operation.sequence).toBe(3);

    const joined = await joinForSync(roomId, "Observer");
    expect(joined.sync.operations.map(operationLabel)).toEqual([
      "stroke:old",
      "clear",
      "stroke:active",
    ]);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
    joined.socket.close(1000, "done");
  });

  it("returns a typed error for malformed clear and keeps the socket usable", async () => {
    const roomId = "clear004";
    const socket = await openRoomSocket(roomId);
    const invalid = waitForMessage(
      socket,
      (message): message is Extract<ServerMessage, { type: "error" }> =>
        message.type === "error" && message.code === "invalid_payload",
    );
    socket.send(
      JSON.stringify({
        type: "canvas:clear",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    await invalid;

    await joinAndDrain(socket, roomId, "Recovered");
    const committed = waitForCommittedKind(socket, "clear");
    sendClear(socket, roomId);
    expect((await committed).operation.sequence).toBe(1);
    socket.close(1000, "done");
  });
});

function operationLabel(operation: CommittedOperation): string {
  if (operation.kind === "clear") {
    return "clear";
  }
  if (
    operation.kind === "rect" ||
    operation.kind === "line" ||
    operation.kind === "ellipse" ||
    operation.kind === "arrow"
  ) {
    return `${operation.kind}:${operation.shapeId}`;
  }
  return `stroke:${operation.strokeId}`;
}

function sendClear(socket: WebSocket, roomId: string): void {
  socket.send(
    JSON.stringify({
      type: "canvas:clear",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
    }),
  );
}

function sendHistory(
  socket: WebSocket,
  roomId: string,
  type: "history:undo" | "history:redo",
): void {
  socket.send(
    JSON.stringify({
      type,
      protocolVersion: PROTOCOL_VERSION,
      roomId,
    }),
  );
}

async function completeStroke(
  socket: WebSocket,
  roomId: string,
  strokeId: string,
): Promise<void> {
  const committed = waitForMessage(
    socket,
    (
      message,
    ): message is Extract<ServerMessage, { type: "operation:committed" }> =>
      message.type === "operation:committed" &&
      message.operation.kind === "stroke" &&
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
      point: { x: 10, y: 10 },
    }),
  );
  socket.send(
    JSON.stringify({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
      point: { x: 40, y: 40 },
    }),
  );
  await committed;
}

function waitForCommittedKind(
  socket: WebSocket,
  kind: CommittedOperation["kind"],
): Promise<Extract<ServerMessage, { type: "operation:committed" }>> {
  return waitForMessage(
    socket,
    (
      message,
    ): message is Extract<ServerMessage, { type: "operation:committed" }> =>
      message.type === "operation:committed" &&
      message.operation.kind === kind,
  );
}

function waitForHistoryLabels(
  socket: WebSocket,
  labels: string[],
): Promise<Extract<ServerMessage, { type: "history:changed" }>> {
  return waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
      message.type === "history:changed" &&
      JSON.stringify(message.operations.map(operationLabel)) ===
        JSON.stringify(labels),
  );
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
