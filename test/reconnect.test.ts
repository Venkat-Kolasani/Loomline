import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";
import { LIVE_STROKE_STALL_MS } from "../worker/room";
import { CommittedOperationStore } from "../client/src/canvas/committed-ops";
import type { CommittedOperation } from "../shared/protocol";

describe("reconnect and durable recovery", () => {
  it("rejoins with the same committed snapshot after a socket drop", async () => {
    const roomId = "rrrr1111";
    const socketA = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Stay");

    await completeStroke(socketA, roomId, "keep-me", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    await completeStroke(socketA, roomId, "keep-two", "#be123c", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);

    // Simulate client B leaving and reconnecting (refresh / network drop).
    const socketB1 = await openRoomSocket(roomId);
    await joinAndDrain(socketB1, roomId, "Transient");
    socketB1.close(1000, "drop");

    const socketB2 = await openRoomSocket(roomId);
    const sync = waitForMessage(
      socketB2,
      (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
        message.type === "sync_state" && message.operations.length === 2,
    );
    await joinAndWaitWelcome(socketB2, roomId, "Transient");
    const snapshot = await sync;

    expect(snapshot.sequenceHead).toBe(2);
    expect(snapshot.operations.map((op) => op.strokeId)).toEqual([
      "keep-me",
      "keep-two",
    ]);

    socketA.close(1000, "done");
    socketB2.close(1000, "done");
  });

  it("rehydrates durable sequence head from SQLite after ops commit", async () => {
    const roomId = "ssss2222";
    const socket = await openRoomSocket(roomId);
    await joinAndDrain(socket, roomId, "Persist");
    await completeStroke(socket, roomId, "durable", "#0f6a5a", [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    const response = await stub.fetch(
      new Request("https://room/test/durable-head"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sequenceHead: number;
      operationCount: number;
      liveStrokeCount: number;
    };
    expect(body.sequenceHead).toBe(1);
    expect(body.operationCount).toBe(1);
    expect(body.liveStrokeCount).toBe(0);

    socket.close(1000, "done");
  });

  it("expires a stalled provisional stroke without committing", async () => {
    const roomId = "tttt3333";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Author");
    await joinAndDrain(socketB, roomId, "Peer");
    await waitForPresence(socketB, (p) => p.length === 2);

    const liveEnd = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "end" &&
        message.strokeId === "stalled",
    );
    const expiredError = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "error" }> =>
        message.type === "error" && message.code === "stroke_expired",
    );

    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "stalled",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 5, y: 5 },
      }),
    );
    await waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "stalled",
    );

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    const expireResponse = await stub.fetch(
      new Request("https://room/test/expire-stale-strokes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ now: Date.now() + LIVE_STROKE_STALL_MS + 1 }),
      }),
    );
    expect(expireResponse.status).toBe(200);
    const expiredBody = (await expireResponse.json()) as { expired: number };
    expect(expiredBody.expired).toBe(1);

    await Promise.all([liveEnd, expiredError]);

    const head = await stub.fetch(new Request("https://room/test/durable-head"));
    const durable = (await head.json()) as {
      sequenceHead: number;
      operationCount: number;
      liveStrokeCount: number;
      pendingExpiryCount: number;
    };
    expect(durable.sequenceHead).toBe(0);
    expect(durable.operationCount).toBe(0);
    expect(durable.liveStrokeCount).toBe(0);
    expect(durable.pendingExpiryCount).toBe(0);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });
});

describe("duplicate committed-event suppression", () => {
  it("ignores an already-applied sequence after sync and late fan-out", () => {
    const store = new CommittedOperationStore();
    const first = makeOp(1, "a");
    const second = makeOp(2, "b");
    store.applySyncState(2, [first, second]);
    expect(store.applyCommitted(second)).toBe(false);
    expect(store.applyCommitted(makeOp(2, "b-dupe"))).toBe(false);
    expect(store.getOperations()).toHaveLength(2);
    expect(store.hasAppliedSequence(2)).toBe(true);
    expect(store.getLastAppliedSequence()).toBe(2);
  });
});

function makeOp(sequence: number, strokeId: string): CommittedOperation {
  return {
    sequence,
    opId: `op-${sequence}`,
    participantId: "p1",
    strokeId,
    tool: "brush",
    color: "#0f6a5a",
    width: 4,
    points: [
      { x: sequence, y: sequence },
      { x: sequence + 1, y: sequence + 1 },
    ],
    createdAt: sequence * 1000,
  };
}

async function completeStroke(
  socket: WebSocket,
  roomId: string,
  strokeId: string,
  color: string,
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
      color,
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

function waitForPresence(
  socket: WebSocket,
  predicate: (
    participants: Extract<ServerMessage, { type: "presence" }>["participants"],
  ) => boolean,
): Promise<Extract<ServerMessage, { type: "presence" }>> {
  return waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "presence" }> =>
      message.type === "presence" && predicate(message.participants),
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
      const message = parseServer(event);
      if (!message || !predicate(message)) {
        return;
      }
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }

    socket.addEventListener("message", onMessage);
  });
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
