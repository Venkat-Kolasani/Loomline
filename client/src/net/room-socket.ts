import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type CommittedOperation,
  type ServerMessage,
  type StrokePoint,
} from "../../../shared/protocol";
import type { Participant } from "../../../shared/room";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface RoomSocketHandlers {
  onConnectionState: (state: ConnectionState) => void;
  onWelcome: (participant: Participant, roomId: string) => void;
  onPresence: (participants: Participant[], roomId: string) => void;
  onStrokeLive: (
    message: Extract<ServerMessage, { type: "stroke:live" }>,
  ) => void;
  onCursor: (message: Extract<ServerMessage, { type: "cursor" }>) => void;
  onSyncState: (
    sequenceHead: number,
    operations: CommittedOperation[],
    roomId: string,
    canUndo: boolean,
    canRedo: boolean,
  ) => void;
  onOperationCommitted: (operation: CommittedOperation, roomId: string) => void;
  onHistoryChanged: (
    sequenceHead: number,
    operations: CommittedOperation[],
    roomId: string,
    canUndo: boolean,
    canRedo: boolean,
  ) => void;
  onError: (code: string, message: string) => void;
}

/**
 * Room WebSocket: join, presence, live strokes, cursors, committed ops, history.
 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private readonly roomId: string;
  private readonly handlers: RoomSocketHandlers;
  private readonly displayName?: string;
  private joined = false;

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
      this.send({
        type: "join",
        protocolVersion: PROTOCOL_VERSION,
        roomId: this.roomId,
        displayName: this.displayName,
      });
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
      this.joined = false;
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
    this.joined = false;
    if (!socket) {
      return;
    }
    this.socket = null;
    socket.close();
  }

  isReady(): boolean {
    return this.joined && this.socket?.readyState === WebSocket.OPEN;
  }

  sendStrokeStart(payload: {
    strokeId: string;
    tool: "brush" | "eraser";
    color: string;
    width: number;
    point: StrokePoint;
  }): void {
    this.send({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      ...payload,
    });
  }

  sendStrokePoints(strokeId: string, points: StrokePoint[]): void {
    if (points.length === 0) {
      return;
    }
    this.send({
      type: "stroke:points",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      strokeId,
      points,
    });
  }

  sendStrokeEnd(strokeId: string, point?: StrokePoint): void {
    this.send({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      strokeId,
      point,
    });
  }

  sendCursor(x: number, y: number): void {
    this.send({
      type: "cursor",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      x,
      y,
    });
  }

  sendHistoryUndo(): void {
    this.send({
      type: "history:undo",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
    });
  }

  sendHistoryRedo(): void {
    this.send({
      type: "history:redo",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
    });
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.joined = true;
        this.handlers.onConnectionState("connected");
        this.handlers.onWelcome(message.participant, message.roomId);
        break;
      case "presence":
        this.handlers.onPresence(message.participants, message.roomId);
        break;
      case "stroke:live":
        this.handlers.onStrokeLive(message);
        break;
      case "cursor":
        this.handlers.onCursor(message);
        break;
      case "sync_state":
        this.handlers.onSyncState(
          message.sequenceHead,
          message.operations,
          message.roomId,
          message.canUndo,
          message.canRedo,
        );
        break;
      case "operation:committed":
        this.handlers.onOperationCommitted(message.operation, message.roomId);
        break;
      case "history:changed":
        this.handlers.onHistoryChanged(
          message.sequenceHead,
          message.operations,
          message.roomId,
          message.canUndo,
          message.canRedo,
        );
        break;
      case "error":
        this.handlers.onError(message.code, message.message);
        break;
      default:
        this.handlers.onError("unknown_type", "Unsupported server message.");
    }
  }
}
