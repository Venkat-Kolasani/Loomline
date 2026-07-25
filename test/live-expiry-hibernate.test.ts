import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

describe("live-stroke expiry across hibernation", () => {
  it("clears peer live ink via SQLite expiry after evictDurableObject + alarm", async () => {
    const roomId = "uuuu4444";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);
    await joinAndDrain(socketA, roomId, "Author");
    await joinAndDrain(socketB, roomId, "Peer");
    await waitForPresence(socketB, (p) => p.length === 2);

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));

    const liveEnd = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "end" &&
        message.strokeId === "hibernated-stall",
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
        strokeId: "hibernated-stall",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 8, y: 8 },
      }),
    );
    await waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "hibernated-stall",
    );

    const beforeEvict = await readDurableHead(stub);
    expect(beforeEvict.liveStrokeCount).toBe(1);
    expect(beforeEvict.pendingExpiryCount).toBe(1);
    expect(beforeEvict.operationCount).toBe(0);

    // Hibernatable sockets stay connected; in-memory liveStrokes is wiped.
    await evictDurableObject(stub);

    const afterEvict = await readDurableHead(stub);
    expect(afterEvict.liveStrokeCount).toBe(0);
    expect(afterEvict.pendingExpiryCount).toBe(1);

    // Arm a future alarm against durable expiry metadata (points were never stored).
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE live_stroke_expiry SET expires_at = ? WHERE stroke_id = ?`,
        Date.now() - 1,
        "hibernated-stall",
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);

    await Promise.all([liveEnd, expiredError]);

    const afterAlarm = await readDurableHead(stub);
    expect(afterAlarm.sequenceHead).toBe(0);
    expect(afterAlarm.operationCount).toBe(0);
    expect(afterAlarm.liveStrokeCount).toBe(0);
    expect(afterAlarm.pendingExpiryCount).toBe(0);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });
});

async function readDurableHead(
  stub: DurableObjectStub,
): Promise<{
  sequenceHead: number;
  operationCount: number;
  liveStrokeCount: number;
  pendingExpiryCount: number;
}> {
  const response = await stub.fetch(
    new Request("https://room/test/durable-head"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    sequenceHead: number;
    operationCount: number;
    liveStrokeCount: number;
    pendingExpiryCount: number;
  };
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
