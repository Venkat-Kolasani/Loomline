import {
  PROTOCOL_VERSION,
  type Participant,
  type ServerMessage,
} from "../../../shared/room";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface RoomSocketHandlers {
  onConnectionState: (state: ConnectionState) => void;
  onWelcome: (participant: Participant, roomId: string) => void;
  onPresence: (participants: Participant[], roomId: string) => void;
  onError: (code: string, message: string) => void;
}

/**
 * Presence-only room socket. Does not send drawing points.
 * Handlers ignore events from superseded sockets after reconnect/disconnect.
 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private readonly roomId: string;
  private readonly handlers: RoomSocketHandlers;
  private readonly displayName?: string;

  constructor(
    roomId: string,
    handlers: RoomSocketHandlers,
    displayName?: string,
  ) {
    this.roomId = roomId;
    this.handlers = handlers;
    this.displayName = displayName;
  }

  connect(): void {
    this.disconnect();
    this.handlers.onConnectionState("connecting");

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws?room=${encodeURIComponent(this.roomId)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: "join",
          protocolVersion: PROTOCOL_VERSION,
          roomId: this.roomId,
          displayName: this.displayName,
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        return;
      }
      if (typeof event.data !== "string") {
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        this.handlers.onError("invalid_json", "Server sent invalid JSON.");
        return;
      }
      this.handleServerMessage(message);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.handlers.onConnectionState("disconnected");
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.handlers.onConnectionState("error");
    });
  }

  disconnect(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    // Clear before close so the close/error handlers treat this socket as superseded.
    this.socket = null;
    socket.close();
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.handlers.onConnectionState("connected");
        this.handlers.onWelcome(message.participant, message.roomId);
        break;
      case "presence":
        this.handlers.onPresence(message.participants, message.roomId);
        break;
      case "error":
        this.handlers.onError(message.code, message.message);
        break;
      default:
        this.handlers.onError("unknown_type", "Unsupported server message.");
    }
  }
}
