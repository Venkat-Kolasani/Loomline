import { DurableObject } from "cloudflare:workers";
import {
  PROTOCOL_VERSION,
  colorForParticipantId,
  defaultDisplayName,
  isValidRoomId,
  type ClientMessage,
  type Participant,
  type ServerMessage,
  type SocketAttachment,
} from "../shared/room";

const ISOLATION_MARK_KEY = "isolationMark";

/**
 * One Durable Object instance per room id (via idFromName).
 * This slice: WebSocket join + presence only. No drawing sync yet.
 */
export class RoomDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Test-only routes are called on the DO stub directly, not via the public Worker.
    if (url.pathname === "/test/mark") {
      if (request.method === "PUT") {
        const value = await request.text();
        await this.ctx.storage.put(ISOLATION_MARK_KEY, value);
        return new Response("ok");
      }
      if (request.method === "GET") {
        const value = (await this.ctx.storage.get<string>(ISOLATION_MARK_KEY)) ?? "";
        return new Response(value);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const roomId = url.searchParams.get("room") ?? "";
    if (!isValidRoomId(roomId)) {
      return new Response("Invalid room id", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      roomId,
      participantId: "",
      displayName: "",
      color: "",
    } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      this.sendError(ws, "invalid_payload", "Binary frames are not supported.");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message) as unknown;
    } catch {
      this.sendError(ws, "invalid_json", "Message must be JSON.");
      return;
    }

    const join = parseJoinMessage(parsed);
    if (!join) {
      this.sendError(
        ws,
        "unsupported_type",
        "Only join messages are accepted in this slice.",
      );
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const roomId = attachment?.roomId ?? join.roomId;
    if (!isValidRoomId(roomId) || join.roomId !== roomId) {
      this.sendError(ws, "room_mismatch", "roomId does not match this socket.");
      return;
    }

    if (attachment?.participantId) {
      this.sendError(ws, "already_joined", "Already joined this room.");
      return;
    }

    const participantId = crypto.randomUUID();
    const displayName = sanitizeDisplayName(
      join.displayName,
      defaultDisplayName(participantId),
    );
    const color = colorForParticipantId(participantId);
    const nextAttachment: SocketAttachment = {
      roomId,
      participantId,
      displayName,
      color,
    };
    ws.serializeAttachment(nextAttachment);

    const participant: Participant = {
      id: participantId,
      displayName,
      color,
    };

    this.send(ws, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      participant,
    });
    this.broadcastPresence(roomId);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    try {
      ws.close(code, reason);
    } catch {
      // Socket may already be closing.
    }
    if (attachment?.roomId && attachment.participantId) {
      this.broadcastPresence(attachment.roomId);
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    try {
      ws.close(1011, "error");
    } catch {
      // Ignore.
    }
    if (attachment?.roomId && attachment.participantId) {
      this.broadcastPresence(attachment.roomId);
    }
  }

  private broadcastPresence(roomId: string): void {
    const participants = this.listParticipants();
    const message: ServerMessage = {
      type: "presence",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      participants,
    };
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // Drop failed sends; close handling will refresh presence.
      }
    }
  }

  private listParticipants(): Participant[] {
    const participants: Participant[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.participantId) {
        continue;
      }
      participants.push({
        id: attachment.participantId,
        displayName: attachment.displayName,
        color: attachment.color,
      });
    }
    return participants;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, {
      type: "error",
      protocolVersion: PROTOCOL_VERSION,
      code,
      message,
    });
  }
}

function parseJoinMessage(value: unknown): ClientMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "join") {
    return null;
  }
  if (record.protocolVersion !== PROTOCOL_VERSION) {
    return null;
  }
  if (typeof record.roomId !== "string") {
    return null;
  }
  if (
    record.displayName !== undefined &&
    typeof record.displayName !== "string"
  ) {
    return null;
  }
  return {
    type: "join",
    protocolVersion: PROTOCOL_VERSION,
    roomId: record.roomId,
    displayName: record.displayName,
  };
}

function sanitizeDisplayName(
  raw: string | undefined,
  fallback: string,
): string {
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : fallback;
}
