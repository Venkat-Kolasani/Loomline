/**
 * Room WebSocket with exponential reconnect after unexpected close.
 * Intentional disconnect() does not reconnect.
 */

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type CommittedOperation,
  type ServerMessage,
  type StrokePoint,
} from "../../../shared/protocol";
import type { Participant } from "../../../shared/room";
import { reconnectDelayMs } from "./reconnect-backoff";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export interface RoomSocketHandlers {
  onConnectionState: (
    state: ConnectionState,
    detail?: { attempt?: number; delayMs?: number },
  ) => void;
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
  /** Fired when an unexpected close schedules a reconnect (ephemeral UI reset). */
  onReconnectScheduled?: (attempt: number, delayMs: number) => void;
  onPong?: (clientTime: number, serverTime: number) => void;
  onOutboundMessage?: () => void;
  onInboundMessage?: () => void;
}

export class RoomSocket {
  private socket: WebSocket | null = null;
  private readonly roomId: string;
  private readonly handlers: RoomSocketHandlers;
  private readonly displayName?: string;
  private joined = false;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.openSocket(false);
  }

  /** Leave the room permanently — no automatic reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.joined = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.close(1000, "client disconnect");
    }
  }

  isReady(): boolean {
    return this.joined && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Test helper: force-close the socket as if the network dropped. */
  simulateConnectionLoss(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    this.intentionalClose = false;
    socket.close(4000, "simulated loss");
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

  /** One durable rectangle; no intermediate live frames. */
  sendShapeRect(payload: {
    shapeId: string;
    color: string;
    width: number;
    start: StrokePoint;
    end: StrokePoint;
  }): void {
    this.send({
      type: "shape:rect",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      ...payload,
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

  sendCanvasClear(): void {
    this.send({
      type: "canvas:clear",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
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

  sendPing(clientTime: number = performance.now()): void {
    this.send({
      type: "ping",
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      clientTime,
    });
  }

  private openSocket(isReconnect: boolean): void {
    this.joined = false;
    if (this.socket) {
      const previous = this.socket;
      this.socket = null;
      try {
        previous.close();
      } catch {
        // Ignore.
      }
    }

    this.handlers.onConnectionState(isReconnect ? "reconnecting" : "connecting");

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
      this.handlers.onInboundMessage?.();
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
      if (this.intentionalClose) {
        this.handlers.onConnectionState("disconnected");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      // close follows; avoid flipping to permanent error during reconnect storms.
      if (this.intentionalClose) {
        this.handlers.onConnectionState("error");
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) {
      this.handlers.onConnectionState("disconnected");
      return;
    }
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    const delayMs = reconnectDelayMs(this.reconnectAttempt);
    this.handlers.onConnectionState("reconnecting", {
      attempt: this.reconnectAttempt,
      delayMs,
    });
    this.handlers.onReconnectScheduled?.(this.reconnectAttempt, delayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) {
        return;
      }
      this.openSocket(true);
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.handlers.onOutboundMessage?.();
    socket.send(JSON.stringify(message));
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.joined = true;
        this.reconnectAttempt = 0;
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
      case "pong":
        this.handlers.onPong?.(message.clientTime, message.serverTime);
        break;
      case "error":
        this.handlers.onError(message.code, message.message);
        break;
      default:
        this.handlers.onError("unknown_type", "Unsupported server message.");
    }
  }
}
