import { describe, expect, it } from "vitest";
import {
  isDebugEnabled,
  METRIC_LABELS,
} from "../client/src/debug/diagnostics";
import { env, exports } from "cloudflare:workers";
import { PROTOCOL_VERSION, type ServerMessage } from "../shared/protocol";

describe("debug query helpers", () => {
  it("detects ?debug=1", () => {
    expect(isDebugEnabled("?debug=1")).toBe(true);
    expect(isDebugEnabled("?foo=1")).toBe(false);
  });
});

describe("metrics dock labels", () => {
  it("names display cadence honestly instead of canvas FPS", () => {
    expect(METRIC_LABELS.displayRafRate).toBe("Display rAF rate");
    expect(METRIC_LABELS.wsRtt).toBe("WebSocket RTT");
    expect(METRIC_LABELS.inboundRate).toBe("Inbound messages/s");
    expect(METRIC_LABELS.outboundRate).toBe("Outbound messages/s");
    expect(METRIC_LABELS.participants).toBe("Participants");
    expect(METRIC_LABELS.sequenceHead).toBe("Sequence head");
    expect(Object.values(METRIC_LABELS).join(" ")).not.toMatch(/canvas fps/i);
    expect(Object.values(METRIC_LABELS).join(" ")).not.toMatch(/\bfps\b/i);
  });
});

describe("ping/pong RTT echo", () => {
  it("echoes clientTime on pong after join", async () => {
    const roomId = "obsr1010";
    const response = await exports.default.fetch(
      new Request(`https://example.com/ws?room=${roomId}`, {
        headers: { Upgrade: "websocket" },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();

    const welcome = waitFor(
      socket,
      (m): m is Extract<ServerMessage, { type: "welcome" }> =>
        m.type === "welcome",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        displayName: "Ping",
      }),
    );
    await welcome;

    const pong = waitFor(
      socket,
      (m): m is Extract<ServerMessage, { type: "pong" }> => m.type === "pong",
    );
    const clientTime = 12_345.67;
    socket.send(
      JSON.stringify({
        type: "ping",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        clientTime,
      }),
    );
    const echoed = await pong;
    expect(echoed.clientTime).toBe(clientTime);
    expect(typeof echoed.serverTime).toBe("number");

    socket.close(1000, "done");
  });
});

describe("room metrics HTTP", () => {
  it("returns durable-head fields for a valid room", async () => {
    const roomId = "obsr2020";
    const response = await exports.default.fetch(
      new Request(`https://example.com/api/room-metrics?room=${roomId}`),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sequenceHead: number;
      operationCount: number;
    };
    expect(body.sequenceHead).toBe(0);
    expect(body.operationCount).toBe(0);
  });
});

function waitFor<T extends ServerMessage>(
  socket: WebSocket,
  match: (message: ServerMessage) => message is T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("timeout"));
    }, 5_000);
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (match(message)) {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(message);
      }
    };
    socket.addEventListener("message", onMessage);
  });
}
