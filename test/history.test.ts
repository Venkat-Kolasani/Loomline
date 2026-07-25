import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

describe("durable ordered operations", () => {
  it("assigns increasing sequences and same layering to two clients", async () => {
    const roomId = "hhhh1111";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);

    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await waitForPresence(socketB, (p) => p.length === 2);

    const committedOnB: Extract<
      ServerMessage,
      { type: "operation:committed" }
    >[] = [];
    const committedOnA: Extract<
      ServerMessage,
      { type: "operation:committed" }
    >[] = [];

    const collectB = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "operation:committed") {
        committedOnB.push(message);
      }
    };
    const collectA = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "operation:committed") {
        committedOnA.push(message);
      }
    };
    socketB.addEventListener("message", collectB);
    socketA.addEventListener("message", collectA);

    await completeStroke(socketA, roomId, "stroke-bottom", "#0f6a5a", [
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ]);
    await completeStroke(socketB, roomId, "stroke-top", "#be123c", [
      { x: 20, y: 15 },
      { x: 50, y: 45 },
    ]);

    await waitUntil(() => committedOnA.length >= 2 && committedOnB.length >= 2);

    socketA.removeEventListener("message", collectA);
    socketB.removeEventListener("message", collectB);

    const seqA = committedOnA.map((m) => m.operation.sequence);
    const seqB = committedOnB.map((m) => m.operation.sequence);
    expect(seqA).toEqual([1, 2]);
    expect(seqB).toEqual([1, 2]);
    expect(committedOnA.map((m) => m.operation.strokeId)).toEqual([
      "stroke-bottom",
      "stroke-top",
    ]);
    expect(committedOnB.map((m) => m.operation.strokeId)).toEqual([
      "stroke-bottom",
      "stroke-top",
    ]);

    // Overlapping geometry: higher sequence stacks later (drawn on top).
    expect(committedOnA[1]!.operation.sequence).toBeGreaterThan(
      committedOnA[0]!.operation.sequence,
    );

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("gives a joining client the same committed snapshot", async () => {
    const roomId = "iiii2222";
    const socketA = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");

    await completeStroke(socketA, roomId, "s1", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    await completeStroke(socketA, roomId, "s2", "#1d4ed8", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);

    const socketC = await openRoomSocket(roomId);
    const sync = waitForMessage(
      socketC,
      (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
        message.type === "sync_state" && message.operations.length === 2,
    );
    await joinAndWaitWelcome(socketC, roomId, "Artist-C");
    const snapshot = await sync;

    expect(snapshot.sequenceHead).toBe(2);
    expect(snapshot.operations.map((op) => op.sequence)).toEqual([1, 2]);
    expect(snapshot.operations.map((op) => op.strokeId)).toEqual(["s1", "s2"]);

    socketA.close(1000, "done");
    socketC.close(1000, "done");
  });

  it("does not persist a stroke abandoned by socket close mid-draw", async () => {
    const roomId = "jjjj3333";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await waitForPresence(socketB, (p) => p.length === 2);

    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "abandoned",
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
        message.strokeId === "abandoned",
    );

    socketA.close(1000, "abort mid-stroke");

    // B stays; a later join must see an empty committed log.
    const socketC = await openRoomSocket(roomId);
    const sync = waitForMessage(
      socketC,
      (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
        message.type === "sync_state",
    );
    await joinAndWaitWelcome(socketC, roomId, "Artist-C");
    const snapshot = await sync;
    expect(snapshot.sequenceHead).toBe(0);
    expect(snapshot.operations).toEqual([]);

    socketB.close(1000, "done");
    socketC.close(1000, "done");
  });

  it("commits brush then eraser overlaps with stable sequences", async () => {
    const roomId = "kkkk4444";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Brush");
    await joinAndDrain(socketB, roomId, "Eraser");
    await waitForPresence(socketB, (p) => p.length === 2);

    const ops: Extract<ServerMessage, { type: "operation:committed" }>[] = [];
    const collect = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "operation:committed") {
        ops.push(message);
      }
    };
    socketA.addEventListener("message", collect);

    await completeStroke(socketA, roomId, "brush-1", "#0f6a5a", [
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    socketB.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "eraser-1",
        tool: "eraser",
        color: "#334155",
        width: 12,
        point: { x: 40, y: 40 },
      }),
    );
    socketB.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "eraser-1",
        points: [{ x: 60, y: 60 }],
      }),
    );
    socketB.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "eraser-1",
      }),
    );

    await waitUntil(() => ops.length >= 2);
    socketA.removeEventListener("message", collect);

    expect(ops[0]!.operation.tool).toBe("brush");
    expect(ops[1]!.operation.tool).toBe("eraser");
    expect(ops.map((m) => m.operation.sequence)).toEqual([1, 2]);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("assigns distinct sequences for back-to-back ends without awaiting the first commit", async () => {
    const roomId = "llll5555";
    const socketA = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Rapid");

    const committed: Extract<
      ServerMessage,
      { type: "operation:committed" }
    >[] = [];
    const collect = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "operation:committed") {
        committed.push(message);
      }
    };
    socketA.addEventListener("message", collect);

    // Fire two full stroke lifecycles with no await between the first end and
    // the second start — proves sequence allocation under back-to-back ends.
    sendStrokeLifecycle(socketA, roomId, "rapid-1", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    sendStrokeLifecycle(socketA, roomId, "rapid-2", "#be123c", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);

    await waitUntil(() => committed.length >= 2);
    socketA.removeEventListener("message", collect);

    expect(committed.map((m) => m.operation.sequence)).toEqual([1, 2]);
    expect(committed.map((m) => m.operation.strokeId).sort()).toEqual([
      "rapid-1",
      "rapid-2",
    ]);

    socketA.close(1000, "done");
  });
});

describe("global tombstone undo/redo", () => {
  it("lets a client undo another participant's completed stroke", async () => {
    const roomId = "mmmm6666";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await waitForPresence(socketB, (p) => p.length === 2);

    await completeStroke(socketA, roomId, "peer-stroke", "#0f6a5a", [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);

    const historyOnB = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" && message.operations.length === 0,
    );
    const historyOnA = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" && message.operations.length === 0,
    );

    socketB.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );

    const [changedB, changedA] = await Promise.all([historyOnB, historyOnA]);
    expect(changedB.sequenceHead).toBe(1);
    expect(changedB.canUndo).toBe(false);
    expect(changedB.canRedo).toBe(true);
    expect(changedA.operations).toEqual([]);
    expect(changedB.operations).toEqual([]);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("redoes the latest tombstone and converges for two clients", async () => {
    const roomId = "nnnn7777";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");
    await joinAndDrain(socketB, roomId, "Artist-B");
    await waitForPresence(socketB, (p) => p.length === 2);

    await completeStroke(socketA, roomId, "s1", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    await completeStroke(socketB, roomId, "s2", "#be123c", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);

    const undoA = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" &&
        message.operations.map((op) => op.strokeId).join(",") === "s1",
    );
    socketA.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    await undoA;

    const redoOnA = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" &&
        message.operations.map((op) => op.strokeId).join(",") === "s1,s2",
    );
    const redoOnB = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" &&
        message.operations.map((op) => op.strokeId).join(",") === "s1,s2",
    );
    socketB.send(
      JSON.stringify({
        type: "history:redo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    const [restoredA, restoredB] = await Promise.all([redoOnA, redoOnB]);
    expect(restoredA.canUndo).toBe(true);
    expect(restoredA.canRedo).toBe(false);
    expect(restoredB.operations.map((op) => op.sequence)).toEqual([1, 2]);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("clears the redo branch when a new operation is committed", async () => {
    const roomId = "oooo8888";
    const socketA = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Artist-A");

    await completeStroke(socketA, roomId, "old", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);

    const undone = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "history:changed" }> =>
        message.type === "history:changed" && message.canRedo === true,
    );
    socketA.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    await undone;

    await completeStroke(socketA, roomId, "new-branch", "#1d4ed8", [
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ]);

    // Redo must be a no-op after the new commit cleared the redo branch.
    let historyAfterRedo = 0;
    const countHistory = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "history:changed") {
        historyAfterRedo += 1;
      }
    };
    socketA.addEventListener("message", countHistory);
    socketA.send(
      JSON.stringify({
        type: "history:redo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    socketA.removeEventListener("message", countHistory);
    expect(historyAfterRedo).toBe(0);

    const socketB = await openRoomSocket(roomId);
    const sync = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "sync_state" }> =>
        message.type === "sync_state",
    );
    await joinAndWaitWelcome(socketB, roomId, "Artist-B");
    const snapshot = await sync;
    expect(snapshot.operations.map((op) => op.strokeId)).toEqual(["new-branch"]);
    expect(snapshot.canRedo).toBe(false);
    expect(snapshot.canUndo).toBe(true);
    // Append-only log still has both sequences; head stays at 2.
    expect(snapshot.sequenceHead).toBe(2);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("serializes rapid sequential undo/redo without corrupting visibility", async () => {
    const roomId = "pppp9999";
    const socketA = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Rapid");

    await completeStroke(socketA, roomId, "a", "#0f6a5a", [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    await completeStroke(socketA, roomId, "b", "#be123c", [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
    await completeStroke(socketA, roomId, "c", "#1d4ed8", [
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ]);

    const changes: Extract<ServerMessage, { type: "history:changed" }>[] = [];
    const collect = (event: MessageEvent): void => {
      const message = parseServer(event);
      if (message?.type === "history:changed") {
        changes.push(message);
      }
    };
    socketA.addEventListener("message", collect);

    // Fire undo×2 then redo without awaiting between requests.
    socketA.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    socketA.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );
    socketA.send(
      JSON.stringify({
        type: "history:redo",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
      }),
    );

    await waitUntil(() => changes.length >= 3);
    socketA.removeEventListener("message", collect);

    expect(changes.map((m) => m.operations.map((op) => op.strokeId).join(","))).toEqual([
      "a,b",
      "a",
      "a,b",
    ]);
    const last = changes[changes.length - 1]!;
    expect(last.canUndo).toBe(true);
    expect(last.canRedo).toBe(true);
    expect(last.sequenceHead).toBe(3);

    socketA.close(1000, "done");
  });
});

function sendStrokeLifecycle(
  socket: WebSocket,
  roomId: string,
  strokeId: string,
  color: string,
  points: { x: number; y: number }[],
): void {
  const first = points[0]!;
  const rest = points.slice(1);
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

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
