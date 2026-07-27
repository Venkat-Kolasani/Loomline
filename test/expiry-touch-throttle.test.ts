import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

/**
 * Before throttle: every accepted stroke:points batch upserted live_stroke_expiry
 * (~1 write per rAF). After: start always touches once; points only when the
 * wall-clock interval has elapsed. Counted via RoomDurableObject.expiryTouchCount.
 */
describe("live_stroke_expiry touch throttle", () => {
  afterEach(async () => {
    const stub = env.ROOM.get(env.ROOM.idFromName("thrttl00"));
    await stub.fetch(
      new Request("https://room/test/expiry-touch-interval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ms: null }),
      }),
    );
  });

  it("touches expiry once per long interval despite many points batches", async () => {
    const roomId = "thrttl01";
    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    await stub.fetch(
      new Request("https://room/test/expiry-touch-interval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ms: 5_000 }),
      }),
    );

    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Drawer");
    await joinAndDrain(socketB, roomId, "Peer");

    const strokeId = "throttle-stroke";
    const peerSawStart = waitForLive(socketB, "start", strokeId);
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 0.1, y: 0.1 },
      }),
    );
    await peerSawStart;

    const afterStart = await readDurableHead(stub);
    expect(afterStart.expiryTouchCount).toBe(1);

    const rapidBatches = 24;
    let lastPeerPoints: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < rapidBatches; i += 1) {
      lastPeerPoints = waitForLive(socketB, "points", strokeId);
      socketA.send(
        JSON.stringify({
          type: "stroke:points",
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          strokeId,
          points: [{ x: 0.1 + i * 0.01, y: 0.1 + i * 0.01 }],
        }),
      );
    }
    await lastPeerPoints;

    const afterRapid = await readDurableHead(stub);
    // Pre-fix: would be 1 + rapidBatches (= 25). Post-fix: still 1 within window.
    expect(afterRapid.expiryTouchCount).toBe(1);
    expect(afterRapid.liveStrokeCount).toBe(1);

    const committed = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "operation:committed" }> =>
        message.type === "operation:committed" &&
        message.operation.kind === "stroke",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        point: { x: 0.9, y: 0.9 },
      }),
    );
    await committed;

    const afterEnd = await readDurableHead(stub);
    expect(afterEnd.expiryTouchCount).toBe(1);
    expect(afterEnd.operationCount).toBe(1);
    expect(afterEnd.liveStrokeCount).toBe(0);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("refreshes expiry after the throttle window elapses", async () => {
    const roomId = "thrttl02";
    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    await stub.fetch(
      new Request("https://room/test/expiry-touch-interval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ms: 200 }),
      }),
    );

    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Drawer");
    await joinAndDrain(socketB, roomId, "Peer");

    const strokeId = "throttle-window";
    const peerSawStart = waitForLive(socketB, "start", strokeId);
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        tool: "brush",
        color: "#c45c26",
        width: 4,
        point: { x: 0.2, y: 0.2 },
      }),
    );
    await peerSawStart;
    expect((await readDurableHead(stub)).expiryTouchCount).toBe(1);

    const peerSawFirstPoints = waitForLive(socketB, "points", strokeId);
    socketA.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        points: [{ x: 0.25, y: 0.25 }],
      }),
    );
    await peerSawFirstPoints;
    expect((await readDurableHead(stub)).expiryTouchCount).toBe(1);

    await delay(250);

    const peerSawSecondPoints = waitForLive(socketB, "points", strokeId);
    socketA.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
        points: [{ x: 0.3, y: 0.3 }],
      }),
    );
    await peerSawSecondPoints;

    expect((await readDurableHead(stub)).expiryTouchCount).toBe(2);

    const committed = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "operation:committed" }> =>
        message.type === "operation:committed",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId,
      }),
    );
    await committed;

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });
});

async function readDurableHead(stub: DurableObjectStub): Promise<{
  expiryTouchCount: number;
  liveStrokeCount: number;
  operationCount: number;
}> {
  const response = await stub.fetch(
    new Request("https://room/test/durable-head"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    expiryTouchCount: number;
    liveStrokeCount: number;
    operationCount: number;
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

function waitForLive(
  socket: WebSocket,
  phase: "start" | "points" | "end",
  strokeId: string,
): Promise<Extract<ServerMessage, { type: "stroke:live" }>> {
  return waitForMessage(
    socket,
    (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
      message.type === "stroke:live" &&
      message.phase === phase &&
      message.strokeId === strokeId,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
