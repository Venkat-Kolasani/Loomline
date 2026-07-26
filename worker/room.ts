import { DurableObject } from "cloudflare:workers";
import {
  MAX_DISPLAY_NAME_LENGTH,
  parseClientMessage,
  type ClientMessage,
  type CommittedOperation,
  type ServerMessage,
  type StrokeLivePhase,
  type StrokePoint,
} from "../shared/protocol";
import { MAX_CLIENT_MESSAGE_BYTES } from "../shared/limits";
import {
  PROTOCOL_VERSION,
  colorForParticipantId,
  defaultDisplayName,
  isValidRoomId,
  type Participant,
  type SocketAttachment,
} from "../shared/room";
import {
  ensureOperationSchema,
  insertOperation,
  listOperations,
  nextSequence,
  sequenceHead,
  type StoredOperation,
} from "./operations";
import {
  applyRedo,
  applyUndo,
  canRedo,
  canUndo,
  clearRedoBranch,
  ensureHistorySchema,
  filterVisibleOperations,
  listHiddenSequences,
} from "./history";
import {
  clearAllLiveStrokeExpiry,
  countLiveStrokeExpiry,
  deleteLiveStrokeExpiry,
  deleteLiveStrokeExpiryForParticipant,
  ensureLiveExpirySchema,
  listExpiredLiveStrokes,
  soonestLiveStrokeExpiry,
  upsertLiveStrokeExpiry,
} from "./live-expiry";
import {
  allowParticipantMessage,
  effectiveMaxMessagesPerWindow,
  setTestMaxMessagesPerWindow,
  type RateLimitState,
} from "./rate-limit";

const ISOLATION_MARK_KEY = "isolationMark";

/** Idle provisional strokes expire after this many ms. Points are not persisted. */
export const LIVE_STROKE_STALL_MS = 30_000;

/**
 * One Durable Object instance per room id (via idFromName).
 * Live strokes are ephemeral; stroke:end persists one ordered operation.
 * Undo/redo uses tombstones; the operation log is never mutated.
 * Constructor reloads SQLite schema/state safely after hibernation.
 */
export class RoomDurableObject extends DurableObject<Env> {
  /**
   * Ephemeral in-memory live strokes for this isolate wake.
   * Points do not survive hibernation. Expiry metadata is in SQLite so an
   * alarm after wake can still clear peer overlays.
   */
  private readonly liveStrokes = new Map<string, LiveStrokeState>();
  /** Ephemeral per-participant frame counters; fine to reset on eviction. */
  private readonly messageRates = new Map<string, RateLimitState>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hibernation wake: durable ops/history/expiry live in SQLite; live map empty.
    ctx.blockConcurrencyWhile(async () => {
      ensureOperationSchema(this.ctx.storage.sql);
      ensureHistorySchema(this.ctx.storage.sql);
      ensureLiveExpirySchema(this.ctx.storage.sql);
      // Re-arm stall alarm from durable expiry rows after hibernation wake.
      const soonest = soonestLiveStrokeExpiry(this.ctx.storage.sql);
      if (soonest !== null) {
        await this.ctx.storage.setAlarm(soonest);
      }
    });
  }

  async alarm(): Promise<void> {
    await this.expireStaleLiveStrokes(Date.now());
  }

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
        const value =
          (await this.ctx.storage.get<string>(ISOLATION_MARK_KEY)) ?? "";
        return new Response(value);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/test/simulate-ws-error" && request.method === "POST") {
      const participantId = (await request.text()).trim();
      if (!participantId) {
        return new Response("participant id required", { status: 400 });
      }
      const found = await this.simulateErrorForParticipant(participantId);
      return new Response(found ? "ok" : "not found", {
        status: found ? 200 : 404,
      });
    }

    if (url.pathname === "/test/rate-limit-max" && request.method === "POST") {
      try {
        const body = (await request.json()) as { max?: number | null };
        if (body.max === null) {
          setTestMaxMessagesPerWindow(null);
          return Response.json({ max: null });
        }
        if (
          typeof body.max === "number" &&
          Number.isInteger(body.max) &&
          body.max > 0
        ) {
          setTestMaxMessagesPerWindow(body.max);
          return Response.json({ max: body.max });
        }
      } catch {
        // Fall through to 400.
      }
      return new Response("Expected JSON { max: positive int | null }", {
        status: 400,
      });
    }

    if (url.pathname === "/test/durable-head" && request.method === "GET") {
      const head = sequenceHead(this.ctx.storage.sql);
      const ops = listOperations(this.ctx.storage.sql);
      const alarmAt = await this.ctx.storage.getAlarm();
      return Response.json({
        sequenceHead: head,
        operationCount: ops.length,
        liveStrokeCount: this.liveStrokes.size,
        pendingExpiryCount: countLiveStrokeExpiry(this.ctx.storage.sql),
        alarmScheduled: alarmAt !== null,
        rateLimitEntries: this.messageRates.size,
      });
    }

    if (url.pathname === "/test/expire-stale-strokes" && request.method === "POST") {
      let now = Date.now();
      try {
        const body = (await request.json()) as { now?: number };
        if (typeof body.now === "number" && Number.isFinite(body.now)) {
          now = body.now;
        }
      } catch {
        // Default to Date.now().
      }
      const expired = await this.expireStaleLiveStrokes(now);
      return Response.json({ expired });
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
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const participantId = attachment?.participantId;

    if (typeof message !== "string") {
      // Count binary floods toward the budget before rejecting.
      if (
        participantId &&
        !this.consumeRateLimit(participantId)
      ) {
        this.sendError(
          ws,
          "rate_limited",
          "Too many messages; slow down while keeping the room alive.",
        );
        return;
      }
      this.sendError(ws, "invalid_payload", "Binary frames are not supported.");
      return;
    }

    const byteLength = new TextEncoder().encode(message).byteLength;
    if (byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      if (
        participantId &&
        !this.consumeRateLimit(participantId)
      ) {
        this.sendError(
          ws,
          "rate_limited",
          "Too many messages; slow down while keeping the room alive.",
        );
        return;
      }
      this.sendError(
        ws,
        "payload_too_large",
        `Message exceeds ${MAX_CLIENT_MESSAGE_BYTES} UTF-8 bytes.`,
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message) as unknown;
    } catch {
      if (
        participantId &&
        !this.consumeRateLimit(participantId)
      ) {
        this.sendError(
          ws,
          "rate_limited",
          "Too many messages; slow down while keeping the room alive.",
        );
        return;
      }
      this.sendError(ws, "invalid_json", "Message must be JSON.");
      return;
    }

    const result = parseClientMessage(parsed);
    if (!result.ok) {
      if (
        participantId &&
        !this.consumeRateLimit(participantId)
      ) {
        this.sendError(
          ws,
          "rate_limited",
          "Too many messages; slow down while keeping the room alive.",
        );
        return;
      }
      this.sendError(ws, result.code, result.message);
      return;
    }

    const roomId = attachment?.roomId ?? result.message.roomId;
    if (!isValidRoomId(roomId) || result.message.roomId !== roomId) {
      this.sendError(ws, "room_mismatch", "roomId does not match this socket.");
      return;
    }

    // Valid protocol messages are never rate-limited. The budget only applies
    // to abuse frames above (binary / oversized / malformed / parse failures)
    // so normal drawing, cursor, history, and ping cannot starve stroke:end.

    switch (result.message.type) {
      case "join":
        this.handleJoin(ws, attachment, result.message, roomId);
        return;
      case "stroke:start":
      case "stroke:points":
      case "stroke:end":
      case "cursor":
      case "canvas:clear":
      case "history:undo":
      case "history:redo":
      case "ping":
        this.handleJoinedMessage(ws, attachment, result.message, roomId);
        return;
    }
  }

  private consumeRateLimit(participantId: string): boolean {
    return allowParticipantMessage(
      this.messageRates,
      participantId,
      Date.now(),
      effectiveMaxMessagesPerWindow(),
    );
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
    this.abandonLiveStrokesForParticipant(attachment?.participantId);
    if (attachment?.participantId) {
      this.messageRates.delete(attachment.participantId);
    }
    this.refreshPresenceAfterDepart(ws, attachment);
    await this.cleanupIfRoomEmpty(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    try {
      ws.close(1011, "error");
    } catch {
      // Ignore.
    }
    this.abandonLiveStrokesForParticipant(attachment?.participantId);
    if (attachment?.participantId) {
      this.messageRates.delete(attachment.participantId);
    }
    this.refreshPresenceAfterDepart(ws, attachment);
    await this.cleanupIfRoomEmpty(ws);
  }

  private async simulateErrorForParticipant(
    participantId: string,
  ): Promise<boolean> {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.participantId === participantId) {
        await this.webSocketError(socket, new Error("simulated"));
        return true;
      }
    }
    return false;
  }

  private handleJoin(
    ws: WebSocket,
    attachment: SocketAttachment | null,
    join: Extract<ClientMessage, { type: "join" }>,
    roomId: string,
  ): void {
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

    const operations = this.visibleOperations();
    const head = sequenceHead(this.ctx.storage.sql);
    this.send(ws, {
      type: "sync_state",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      sequenceHead: head,
      operations,
      canUndo: canUndo(this.ctx.storage.sql, head),
      canRedo: canRedo(this.ctx.storage.sql),
    });

    this.broadcastPresence(roomId);
  }

  private handleJoinedMessage(
    ws: WebSocket,
    attachment: SocketAttachment | null,
    message: Exclude<ClientMessage, { type: "join" }>,
    roomId: string,
  ): void {
    if (!attachment?.participantId) {
      this.sendError(ws, "not_joined", "Join the room before sending strokes.");
      return;
    }

    switch (message.type) {
      case "stroke:start":
        this.handleStrokeStart(ws, attachment, message, roomId);
        return;
      case "stroke:points":
        this.handleStrokePoints(ws, attachment, message, roomId);
        return;
      case "stroke:end":
        this.handleStrokeEnd(ws, attachment, message, roomId);
        return;
      case "cursor":
        this.broadcastExcept(ws, {
          type: "cursor",
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          participantId: attachment.participantId,
          x: message.x,
          y: message.y,
        });
        return;
      case "canvas:clear":
        this.handleCanvasClear(attachment, roomId);
        return;
      case "history:undo":
        this.handleHistoryUndo(roomId);
        return;
      case "history:redo":
        this.handleHistoryRedo(roomId);
        return;
      case "ping":
        this.send(ws, {
          type: "pong",
          protocolVersion: PROTOCOL_VERSION,
          roomId,
          clientTime: message.clientTime,
          serverTime: Date.now(),
        });
        return;
    }
  }

  private handleStrokeStart(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: "stroke:start" }>,
    roomId: string,
  ): void {
    const key = liveKey(attachment.participantId, message.strokeId);
    if (this.liveStrokes.has(key)) {
      this.sendError(ws, "stroke_active", "Stroke already started.");
      return;
    }

    this.liveStrokes.set(key, {
      participantId: attachment.participantId,
      strokeId: message.strokeId,
      tool: message.tool,
      color: message.color,
      width: message.width,
      points: [message.point],
      lastActiveAt: Date.now(),
      roomId,
    });
    this.touchLiveStrokeExpiry(
      attachment.participantId,
      message.strokeId,
      roomId,
      Date.now(),
    );
    void this.scheduleLiveStrokeAlarm();

    this.broadcastStrokeLive(ws, {
      roomId,
      participantId: attachment.participantId,
      strokeId: message.strokeId,
      phase: "start",
      tool: message.tool,
      color: message.color,
      width: message.width,
      points: [message.point],
    });
  }

  private handleStrokePoints(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: "stroke:points" }>,
    roomId: string,
  ): void {
    const key = liveKey(attachment.participantId, message.strokeId);
    const live = this.liveStrokes.get(key);
    if (!live) {
      this.sendError(ws, "unknown_stroke", "No active stroke for strokeId.");
      return;
    }

    live.points.push(...message.points);
    live.lastActiveAt = Date.now();
    this.touchLiveStrokeExpiry(
      attachment.participantId,
      message.strokeId,
      roomId,
      live.lastActiveAt,
    );
    void this.scheduleLiveStrokeAlarm();

    this.broadcastStrokeLive(ws, {
      roomId,
      participantId: attachment.participantId,
      strokeId: message.strokeId,
      phase: "points",
      points: message.points,
    });
  }

  private handleStrokeEnd(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: Extract<ClientMessage, { type: "stroke:end" }>,
    roomId: string,
  ): void {
    const key = liveKey(attachment.participantId, message.strokeId);
    const live = this.liveStrokes.get(key);
    if (!live) {
      this.sendError(ws, "unknown_stroke", "No active stroke for strokeId.");
      return;
    }

    if (message.point) {
      live.points.push(message.point);
    }
    this.liveStrokes.delete(key);
    deleteLiveStrokeExpiry(
      this.ctx.storage.sql,
      attachment.participantId,
      message.strokeId,
    );
    void this.scheduleLiveStrokeAlarm();

    const endPoints = message.point ? [message.point] : [];
    this.broadcastStrokeLive(ws, {
      roomId,
      participantId: attachment.participantId,
      strokeId: message.strokeId,
      phase: "end",
      points: endPoints,
    });

    if (live.points.length === 0) {
      return;
    }

    // New durable ops clear the redo branch; prior tombstones stay hidden.
    clearRedoBranch(this.ctx.storage.sql);

    const stored: StoredOperation = {
      kind: "stroke",
      sequence: nextSequence(this.ctx.storage.sql),
      opId: crypto.randomUUID(),
      participantId: attachment.participantId,
      strokeId: message.strokeId,
      tool: live.tool,
      color: live.color,
      width: live.width,
      points: live.points,
      createdAt: Date.now(),
    };
    insertOperation(this.ctx.storage.sql, stored);

    const operation = toCommitted(stored);
    // Broadcast to ALL sockets including the author so clients share one log.
    this.broadcastRaw(
      JSON.stringify({
        type: "operation:committed",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        operation,
      } satisfies ServerMessage),
    );
  }

  /**
   * Append a replay barrier at the current authoritative sequence.
   * Provisional strokes intentionally remain active: if they end afterward,
   * their stroke operation receives a later sequence and paints over the clear.
   */
  private handleCanvasClear(
    attachment: SocketAttachment,
    roomId: string,
  ): void {
    clearRedoBranch(this.ctx.storage.sql);
    const stored: StoredOperation = {
      kind: "clear",
      sequence: nextSequence(this.ctx.storage.sql),
      opId: crypto.randomUUID(),
      participantId: attachment.participantId,
      createdAt: Date.now(),
    };
    insertOperation(this.ctx.storage.sql, stored);
    this.broadcastRaw(
      JSON.stringify({
        type: "operation:committed",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        operation: toCommitted(stored),
      } satisfies ServerMessage),
    );
  }

  private handleHistoryUndo(roomId: string): void {
    const head = sequenceHead(this.ctx.storage.sql);
    const tombstoned = applyUndo(this.ctx.storage.sql, head);
    if (tombstoned === null) {
      return;
    }
    this.broadcastHistoryChanged(roomId);
  }

  private handleHistoryRedo(roomId: string): void {
    const restored = applyRedo(this.ctx.storage.sql);
    if (restored === null) {
      return;
    }
    this.broadcastHistoryChanged(roomId);
  }

  private broadcastHistoryChanged(roomId: string): void {
    const head = sequenceHead(this.ctx.storage.sql);
    this.broadcastRaw(
      JSON.stringify({
        type: "history:changed",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        sequenceHead: head,
        operations: this.visibleOperations(),
        canUndo: canUndo(this.ctx.storage.sql, head),
        canRedo: canRedo(this.ctx.storage.sql),
      } satisfies ServerMessage),
    );
  }

  private visibleOperations(): CommittedOperation[] {
    const hidden = listHiddenSequences(this.ctx.storage.sql);
    return filterVisibleOperations(
      listOperations(this.ctx.storage.sql).map(toCommitted),
      hidden,
    );
  }

  private broadcastStrokeLive(
    sender: WebSocket,
    payload: {
      roomId: string;
      participantId: string;
      strokeId: string;
      phase: StrokeLivePhase;
      tool?: LiveStrokeState["tool"];
      color?: string;
      width?: number;
      points: StrokePoint[];
    },
  ): void {
    this.broadcastExcept(sender, {
      type: "stroke:live",
      protocolVersion: PROTOCOL_VERSION,
      roomId: payload.roomId,
      participantId: payload.participantId,
      strokeId: payload.strokeId,
      phase: payload.phase,
      tool: payload.tool,
      color: payload.color,
      width: payload.width,
      points: payload.points,
    });
  }

  /** Discard live strokes and tell peers to clear the overlay (no durable op). */
  private abandonLiveStrokesForParticipant(
    participantId: string | undefined,
  ): void {
    if (!participantId) {
      return;
    }
    const fromSql = deleteLiveStrokeExpiryForParticipant(
      this.ctx.storage.sql,
      participantId,
    );
    const seen = new Set<string>();
    for (const row of fromSql) {
      seen.add(liveKey(row.participantId, row.strokeId));
      this.liveStrokes.delete(liveKey(row.participantId, row.strokeId));
      this.broadcastLiveStrokeEnd(row.roomId, row.participantId, row.strokeId);
    }
    for (const [key, live] of [...this.liveStrokes.entries()]) {
      if (!key.startsWith(`${participantId}:`) || seen.has(key)) {
        continue;
      }
      this.liveStrokes.delete(key);
      this.broadcastLiveStrokeEnd(live.roomId, live.participantId, live.strokeId);
    }
    void this.scheduleLiveStrokeAlarm();
  }

  private touchLiveStrokeExpiry(
    participantId: string,
    strokeId: string,
    roomId: string,
    lastActiveAt: number,
  ): void {
    upsertLiveStrokeExpiry(this.ctx.storage.sql, {
      participantId,
      strokeId,
      roomId,
      expiresAt: lastActiveAt + LIVE_STROKE_STALL_MS,
    });
  }

  private broadcastLiveStrokeEnd(
    roomId: string,
    participantId: string,
    strokeId: string,
  ): void {
    this.broadcastRaw(
      JSON.stringify({
        type: "stroke:live",
        protocolVersion: PROTOCOL_VERSION,
        roomId,
        participantId,
        strokeId,
        phase: "end",
        points: [],
      } satisfies ServerMessage),
    );
  }

  private async expireStaleLiveStrokes(now: number): Promise<number> {
    const expiredRows = listExpiredLiveStrokes(this.ctx.storage.sql, now);
    let expired = 0;
    for (const row of expiredRows) {
      deleteLiveStrokeExpiry(
        this.ctx.storage.sql,
        row.participantId,
        row.strokeId,
      );
      this.liveStrokes.delete(liveKey(row.participantId, row.strokeId));
      expired += 1;
      this.broadcastLiveStrokeEnd(row.roomId, row.participantId, row.strokeId);
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment?.participantId === row.participantId) {
          this.sendError(
            socket,
            "stroke_expired",
            "Provisional stroke expired after stall; not committed.",
          );
        }
      }
    }
    await this.scheduleLiveStrokeAlarm();
    return expired;
  }

  private async scheduleLiveStrokeAlarm(): Promise<void> {
    const soonest = soonestLiveStrokeExpiry(this.ctx.storage.sql);
    if (soonest === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(soonest);
  }

  private refreshPresenceAfterDepart(
    departing: WebSocket,
    attachment: SocketAttachment | null,
  ): void {
    if (!attachment?.roomId || !attachment.participantId) {
      return;
    }
    this.broadcastPresence(attachment.roomId, {
      excludeSocket: departing,
      excludeParticipantId: attachment.participantId,
    });
  }

  private broadcastPresence(
    roomId: string,
    options?: {
      excludeSocket?: WebSocket;
      excludeParticipantId?: string;
    },
  ): void {
    const participants = this.listParticipants(options);
    const message: ServerMessage = {
      type: "presence",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      participants,
    };
    this.broadcastRaw(JSON.stringify(message), options?.excludeSocket);
  }

  private broadcastExcept(sender: WebSocket, message: ServerMessage): void {
    this.broadcastRaw(JSON.stringify(message), sender);
  }

  private broadcastRaw(payload: string, exclude?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (exclude && socket === exclude) {
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        // Drop failed sends; close handling will refresh presence.
      }
    }
  }

  private listParticipants(options?: {
    excludeSocket?: WebSocket;
    excludeParticipantId?: string;
  }): Participant[] {
    const participants: Participant[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (options?.excludeSocket && socket === options.excludeSocket) {
        continue;
      }
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.participantId) {
        continue;
      }
      if (
        options?.excludeParticipantId &&
        attachment.participantId === options.excludeParticipantId
      ) {
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

  /**
   * Empty rooms must not retain ephemeral live state or alarms so the DO can
   * hibernate normally. Committed SQLite ops stay — no premature log reset.
   */
  private async cleanupIfRoomEmpty(departing: WebSocket): Promise<void> {
    if (this.listParticipants({ excludeSocket: departing }).length > 0) {
      return;
    }
    this.liveStrokes.clear();
    this.messageRates.clear();
    clearAllLiveStrokeExpiry(this.ctx.storage.sql);
    await this.ctx.storage.deleteAlarm();
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

interface LiveStrokeState {
  participantId: string;
  strokeId: string;
  tool: "brush" | "eraser";
  color: string;
  width: number;
  points: StrokePoint[];
  lastActiveAt: number;
  roomId: string;
}

function liveKey(participantId: string, strokeId: string): string {
  return `${participantId}:${strokeId}`;
}

function toCommitted(op: StoredOperation): CommittedOperation {
  const base = {
    sequence: op.sequence,
    opId: op.opId,
    participantId: op.participantId,
    createdAt: op.createdAt,
  };
  if (op.kind === "clear") {
    return {
      ...base,
      kind: "clear",
    };
  }
  return {
    ...base,
    kind: "stroke",
    strokeId: op.strokeId,
    tool: op.tool,
    color: op.color,
    width: op.width,
    points: op.points,
  };
}

function sanitizeDisplayName(
  raw: string | undefined,
  fallback: string,
): string {
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : fallback;
}
