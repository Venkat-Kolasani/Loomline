import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";
import { createRoomId, isValidRoomId } from "../shared/room";

describe("room id helpers", () => {
  it("accepts 8-char lowercase hex ids", () => {
    expect(isValidRoomId("abcd1234")).toBe(true);
    expect(isValidRoomId("ABCD1234")).toBe(false);
    expect(isValidRoomId("short")).toBe(false);
  });

  it("creates valid random room ids", () => {
    const id = createRoomId();
    expect(isValidRoomId(id)).toBe(true);
  });
});

describe("room Durable Object isolation", () => {
  it("keeps storage isolated across idFromName room ids", async () => {
    const roomA = "aaaa1111";
    const roomB = "bbbb2222";
    expect(isValidRoomId(roomA)).toBe(true);
    expect(isValidRoomId(roomB)).toBe(true);

    const idA = env.ROOM.idFromName(roomA);
    const idB = env.ROOM.idFromName(roomB);
    expect(idA.toString()).not.toBe(idB.toString());

    const stubA = env.ROOM.get(idA);
    const stubB = env.ROOM.get(idB);

    await stubA.fetch(
      new Request("https://room/test/mark", {
        method: "PUT",
        body: "presence-mark-a",
      }),
    );
    await stubB.fetch(
      new Request("https://room/test/mark", {
        method: "PUT",
        body: "presence-mark-b",
      }),
    );

    const valueA = await (
      await stubA.fetch(new Request("https://room/test/mark"))
    ).text();
    const valueB = await (
      await stubB.fetch(new Request("https://room/test/mark"))
    ).text();

    expect(valueA).toBe("presence-mark-a");
    expect(valueB).toBe("presence-mark-b");
    expect(valueA).not.toBe(valueB);
  });
});

describe("presence departure", () => {
  it("excludes a client that closes from remaining presence", async () => {
    const roomId = "cccc3333";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);

    const welcomeA = await joinAndWaitWelcome(socketA, roomId, "Artist-A");

    const bothVisible = waitForPresence(
      socketA,
      (participants) =>
        participants.length === 2 &&
        participants.some((p) => p.id === welcomeA.participant.id),
    );
    const welcomeB = await joinAndWaitWelcome(socketB, roomId, "Artist-B");
    const withBoth = await bothVisible;
    expect(withBoth.participants.some((p) => p.id === welcomeB.participant.id)).toBe(
      true,
    );

    const departed = waitForPresence(
      socketA,
      (participants) =>
        participants.length === 1 &&
        participants[0]?.id === welcomeA.participant.id &&
        !participants.some((p) => p.id === welcomeB.participant.id),
    );
    socketB.close(1000, "client leaving");
    const afterLeave = await departed;

    expect(afterLeave.participants).toEqual([
      expect.objectContaining({ id: welcomeA.participant.id }),
    ]);

    socketA.close(1000, "done");
  });

  it("excludes a client after webSocketError from remaining presence", async () => {
    const roomId = "dddd4444";
    const socketA = await openRoomSocket(roomId);
    const socketB = await openRoomSocket(roomId);

    const welcomeA = await joinAndWaitWelcome(socketA, roomId, "Artist-A");

    const bothVisible = waitForPresence(
      socketA,
      (participants) =>
        participants.length === 2 &&
        participants.some((p) => p.id === welcomeA.participant.id),
    );
    const welcomeB = await joinAndWaitWelcome(socketB, roomId, "Artist-B");
    const withBoth = await bothVisible;
    expect(withBoth.participants.some((p) => p.id === welcomeB.participant.id)).toBe(
      true,
    );

    const departed = waitForPresence(
      socketA,
      (participants) =>
        participants.length === 1 &&
        participants[0]?.id === welcomeA.participant.id &&
        !participants.some((p) => p.id === welcomeB.participant.id),
    );

    const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
    const simulate = await stub.fetch(
      new Request("https://room/test/simulate-ws-error", {
        method: "POST",
        body: welcomeB.participant.id,
      }),
    );
    expect(simulate.status).toBe(200);

    const afterError = await departed;
    expect(afterError.participants).toEqual([
      expect.objectContaining({ id: welcomeA.participant.id }),
    ]);

    socketA.close(1000, "done");
  });
});

describe("display-name sanitation", () => {
  it("trims a supplied name, caps it at 24 characters, and falls back when blank", async () => {
    const roomId = "name2222";
    const socketA = await openRoomSocket(roomId);
    const trimmed = await joinAndWaitWelcome(socketA, roomId, "  Moss Finch  ");
    expect(trimmed.participant.displayName).toBe("Moss Finch");

    const socketB = await openRoomSocket(roomId);
    const capped = await joinAndWaitWelcome(socketB, roomId, "x".repeat(30));
    expect(capped.participant.displayName).toBe("x".repeat(24));

    const socketC = await openRoomSocket(roomId);
    const fallback = await joinAndWaitWelcome(socketC, roomId, "   ");
    expect(fallback.participant.displayName).toMatch(/^Artist-[a-f0-9]{4}$/);

    socketA.close(1000, "done");
    socketB.close(1000, "done");
    socketC.close(1000, "done");
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
