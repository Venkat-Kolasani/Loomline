import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

describe("live stroke fan-out", () => {
  it("broadcasts stroke:live to peers before stroke:end and rejects bad payloads", async () => {
    const roomId = "eeee5555";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);

    await joinAndWaitWelcome(socketA, roomId, "Artist-A");
    await joinAndWaitWelcome(socketB, roomId, "Artist-B");

    // Drain presence noise by waiting briefly for both joins to settle.
    await waitForPresence(
      socketB,
      (participants) => participants.length === 2,
    );

    const liveStart = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "stroke-demo-1",
    );

    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "stroke-demo-1",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 10, y: 10 },
      }),
    );

    const startMsg = await liveStart;
    expect(startMsg.points).toEqual([{ x: 10, y: 10 }]);
    expect(startMsg.tool).toBe("brush");

    const livePoints = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "points" &&
        message.strokeId === "stroke-demo-1",
    );

    socketA.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "stroke-demo-1",
        points: [
          { x: 20, y: 25 },
          { x: 30, y: 40 },
        ],
      }),
    );

    const pointsMsg = await livePoints;
    expect(pointsMsg.points).toEqual([
      { x: 20, y: 25 },
      { x: 30, y: 40 },
    ]);

    const liveEnd = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "end" &&
        message.strokeId === "stroke-demo-1",
    );

    socketA.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "stroke-demo-1",
      }),
    );

    await liveEnd;

    const bad = waitForMessage(
      socketA,
      (message): message is Extract<ServerMessage, { type: "error" }> =>
        message.type === "error" && message.code === "invalid_payload",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "bad",
        tool: "brush",
        color: "not-a-color",
        width: 4,
        point: { x: 1, y: 1 },
      }),
    );
    const errorMsg = await bad;
    expect(errorMsg.message).toMatch(/color/i);

    // Room still accepts a valid stroke after the typed error.
    const recovered = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "stroke-demo-2",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "stroke-demo-2",
        tool: "eraser",
        color: "#334155",
        width: 8,
        point: { x: 5, y: 5 },
      }),
    );
    await recovered;

    socketA.close(1000, "done");
    socketB.close(1000, "done");
  });

  it("forwards cursor updates while drawing without committing them", async () => {
    const roomId = "ffff6666";
    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);

    const welcomeA = await joinAndWaitWelcome(socketA, roomId, "Cursor-A");
    await joinAndWaitWelcome(socketB, roomId, "Cursor-B");
    await waitForPresence(socketB, (p) => p.length === 2);

    const liveStart = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "stroke:live" }> =>
        message.type === "stroke:live" &&
        message.phase === "start" &&
        message.strokeId === "cursor-stroke",
    );
    socketA.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        strokeId: "cursor-stroke",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 0.1, y: 0.2 },
      }),
    );
    await liveStart;

    const cursor = waitForMessage(
      socketB,
      (message): message is Extract<ServerMessage, { type: "cursor" }> =>
        message.type === "cursor" &&
        message.participantId === welcomeA.participant.id,
    );

    socketA.send(
      JSON.stringify({
        type: "cursor",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        x: 0.42,
        y: 0.84,
      }),
    );

    const cursorMsg = await cursor;
    expect(cursorMsg.x).toBe(0.42);
    expect(cursorMsg.y).toBe(0.84);

    const headResponse = await stub.fetch(
      new Request("https://room/test/durable-head"),
    );
    expect(headResponse.status).toBe(200);
    const head = (await headResponse.json()) as { operationCount: number };
    expect(head.operationCount).toBe(0);

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
