import { CommittedOperationStore } from "./canvas/committed-ops";
import { LayeredCanvasSurface } from "./canvas/layers";
import { LocalDrawingController } from "./canvas/local-drawing";
import { RemoteStrokeStore } from "./canvas/remote-strokes";
import type { DrawingTool } from "./canvas/stroke";
import { LiveStrokeTransport } from "./net/live-stroke-transport";
import { RemoteCursorLayer } from "./net/remote-cursors";
import { RoomSocket } from "./net/room-socket";
import type { Participant } from "../../shared/room";
import { createRoomId, isValidRoomId } from "../../shared/room";
import type { StrokePoint } from "../../shared/protocol";

function requireElement<T extends Element>(
  selector: string,
  guard: (value: Element) => value is T,
): T {
  const node = document.querySelector(selector);
  if (!node || !guard(node)) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return node;
}

const landingView = requireElement(
  "#view-landing",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const roomView = requireElement(
  "#view-room",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const createRoomButton = requireElement(
  "#create-room",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const joinForm = requireElement(
  "#join-form",
  (node): node is HTMLFormElement => node instanceof HTMLFormElement,
);
const joinRoomInput = requireElement(
  "#join-room-id",
  (node): node is HTMLInputElement => node instanceof HTMLInputElement,
);
const joinError = requireElement(
  "#join-error",
  (node): node is HTMLElement => node instanceof HTMLElement,
);

const stage = requireElement(
  "#canvas-stage",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const committedCanvas = requireElement(
  "#committed-canvas",
  (node): node is HTMLCanvasElement => node instanceof HTMLCanvasElement,
);
const liveCanvas = requireElement(
  "#live-canvas",
  (node): node is HTMLCanvasElement => node instanceof HTMLCanvasElement,
);
const cursorLayerRoot = requireElement(
  "#cursor-layer",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const connectionStatus = requireElement(
  "#connection-status",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const emptyState = requireElement(
  "#empty-state",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const roomTitle = requireElement(
  "#room-title",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const roomLink = requireElement(
  "#room-link",
  (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
);
const presenceList = requireElement(
  "#presence-list",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const selfBadge = requireElement(
  "#self-badge",
  (node): node is HTMLElement => node instanceof HTMLElement,
);
const brushButton = requireElement(
  "#tool-brush",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const eraserButton = requireElement(
  "#tool-eraser",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const colorInput = requireElement(
  "#tool-color",
  (node): node is HTMLInputElement => node instanceof HTMLInputElement,
);
const widthInput = requireElement(
  "#tool-width",
  (node): node is HTMLInputElement => node instanceof HTMLInputElement,
);
const clearButton = requireElement(
  "#tool-clear",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const undoButton = requireElement(
  "#tool-undo",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const redoButton = requireElement(
  "#tool-redo",
  (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
);
const widthValue = requireElement(
  "#tool-width-value",
  (node): node is HTMLElement => node instanceof HTMLElement,
);

let drawing!: LocalDrawingController;
let roomSocket: RoomSocket | null = null;
let selfParticipant: Participant | null = null;
const remoteStrokes = new RemoteStrokeStore();
const committedOps = new CommittedOperationStore();
const remoteCursors = new RemoteCursorLayer(cursorLayerRoot);

let liveStrokeTransport: LiveStrokeTransport | null = null;
let pendingCursor: StrokePoint | null = null;
let cursorRaf: number | null = null;

const surface = new LayeredCanvasSurface({
  committedCanvas,
  liveCanvas,
  paintCommitted: (ctx) => {
    committedOps.paint(ctx);
  },
  paintLive: (ctx, size) => {
    remoteStrokes.paintLive(ctx);
    drawing.getPainters().paintLive(ctx, size);
  },
});

drawing = new LocalDrawingController({
  surface,
  liveCanvas,
  onStrokesChanged: () => {
    updateEmptyState();
  },
});

function updateEmptyState(): void {
  const hasRemote = remoteStrokes.getActiveStrokes().length > 0;
  const hasCommitted = committedOps.getOperations().length > 0;
  emptyState.hidden = drawing.hasInk() || hasRemote || hasCommitted;
}

function setHistoryButtons(canUndo: boolean, canRedo: boolean): void {
  undoButton.disabled = !canUndo;
  redoButton.disabled = !canRedo;
}

function resizeSurface(): void {
  const rect = stage.getBoundingClientRect();
  surface.resizeToContainer(rect.width, rect.height);
}

function setActiveTool(tool: DrawingTool): void {
  drawing.setTool(tool);
  brushButton.setAttribute("aria-pressed", tool === "brush" ? "true" : "false");
  eraserButton.setAttribute(
    "aria-pressed",
    tool === "eraser" ? "true" : "false",
  );
  brushButton.classList.toggle("is-active", tool === "brush");
  eraserButton.classList.toggle("is-active", tool === "eraser");
  colorInput.disabled = tool === "eraser";
  colorInput.setAttribute("aria-disabled", tool === "eraser" ? "true" : "false");
}

function syncWidthLabel(): void {
  widthValue.textContent = `${widthInput.value}px`;
}

function parseRoomPath(pathname: string): string | null {
  const match = /^\/r\/([a-z0-9]+)$/.exec(pathname);
  if (!match) {
    return null;
  }
  const roomId = match[1]!;
  return isValidRoomId(roomId) ? roomId : null;
}

function clearNetworkHelpers(): void {
  liveStrokeTransport?.clear();
  liveStrokeTransport = null;
  if (cursorRaf !== null) {
    cancelAnimationFrame(cursorRaf);
    cursorRaf = null;
  }
  pendingCursor = null;
  drawing.setNetworkHooks(undefined);
}

function showLanding(): void {
  roomSocket?.disconnect();
  roomSocket = null;
  selfParticipant = null;
  clearNetworkHelpers();
  remoteStrokes.clearAll();
  committedOps.clear();
  remoteCursors.clear();
  renderPresence([]);
  selfBadge.hidden = true;
  drawing.clearLocal();
  setHistoryButtons(false, false);
  landingView.hidden = false;
  roomView.hidden = true;
  document.title = "Loomline";
  updateEmptyState();
}

function renderPresence(participants: Participant[]): void {
  presenceList.replaceChildren();
  remoteCursors.syncParticipants(participants);
  for (const participant of participants) {
    const item = document.createElement("li");
    item.className = "presence-item";
    const swatch = document.createElement("span");
    swatch.className = "presence-swatch";
    swatch.style.background = participant.color;
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = participant.displayName;
    if (selfParticipant && participant.id === selfParticipant.id) {
      label.textContent = `${participant.displayName} (you)`;
    }
    item.appendChild(swatch);
    item.appendChild(label);
    presenceList.appendChild(item);
  }

  if (selfParticipant) {
    const presentIds = new Set(participants.map((p) => p.id));
    for (const stroke of remoteStrokes.getActiveStrokes()) {
      if (!presentIds.has(stroke.participantId)) {
        const result = remoteStrokes.clearParticipant(stroke.participantId);
        if (result.liveDirty) {
          surface.markDirty("live");
        }
      }
    }
  }
}

function scheduleCursorSend(point: StrokePoint): void {
  pendingCursor = point;
  if (cursorRaf !== null) {
    return;
  }
  cursorRaf = requestAnimationFrame(() => {
    cursorRaf = null;
    const next = pendingCursor;
    pendingCursor = null;
    if (!next || !roomSocket?.isReady()) {
      return;
    }
    roomSocket.sendCursor(next.x, next.y);
  });
}

function wireDrawingNetwork(socket: RoomSocket): void {
  const transport = new LiveStrokeTransport({
    isReady: () => roomSocket === socket && socket.isReady(),
    sendStrokeStart: (event) => {
      socket.sendStrokeStart(event);
    },
    sendStrokePoints: (strokeId, points) => {
      socket.sendStrokePoints(strokeId, points);
    },
    sendStrokeEnd: (strokeId, point) => {
      socket.sendStrokeEnd(strokeId, point);
    },
  });
  liveStrokeTransport = transport;

  drawing.setNetworkHooks({
    onStrokeStart: (event) => {
      if (roomSocket !== socket) {
        return;
      }
      transport.onStrokeStart(event);
    },
    onStrokePoints: (strokeId, points) => {
      if (roomSocket !== socket) {
        return;
      }
      transport.onStrokePoints(strokeId, points);
    },
    onStrokeEnd: (strokeId, point) => {
      if (roomSocket !== socket) {
        return false;
      }
      return transport.onStrokeEnd(strokeId, point);
    },
    onCursor: (point) => {
      if (roomSocket !== socket) {
        return;
      }
      scheduleCursorSend(point);
    },
  });
}

function enterRoom(roomId: string): void {
  // Tear down any prior room session before wiring a new socket.
  roomSocket?.disconnect();
  roomSocket = null;
  selfParticipant = null;
  clearNetworkHelpers();
  remoteStrokes.clearAll();
  committedOps.clear();
  remoteCursors.clear();
  drawing.clearLocal();

  landingView.hidden = true;
  roomView.hidden = false;
  document.title = `Loomline · ${roomId}`;
  roomTitle.textContent = `Room ${roomId}`;
  const shareUrl = `${location.origin}/r/${roomId}`;
  roomLink.href = shareUrl;
  roomLink.textContent = shareUrl;
  connectionStatus.textContent = "Connecting…";
  selfBadge.hidden = true;
  setHistoryButtons(false, false);
  renderPresence([]);

  drawing.setColor(colorInput.value);
  drawing.setWidth(Number(widthInput.value));
  setActiveTool("brush");
  syncWidthLabel();
  resizeSurface();
  surface.paintNow();
  updateEmptyState();

  const socket = new RoomSocket(roomId, {
    onConnectionState: (state, detail) => {
      if (roomSocket !== socket) {
        return;
      }
      if (state === "connecting") {
        connectionStatus.textContent = "Connecting…";
      } else if (state === "reconnecting") {
        const attempt = detail?.attempt ?? 0;
        connectionStatus.textContent =
          attempt > 0 ? `Reconnecting… (try ${attempt})` : "Reconnecting…";
      } else if (state === "connected") {
        connectionStatus.textContent = "Connected";
      } else if (state === "error") {
        connectionStatus.textContent = "Connection error";
      } else {
        connectionStatus.textContent = "Disconnected";
      }
    },
    onReconnectScheduled: () => {
      if (roomSocket !== socket) {
        return;
      }
      // Ephemeral peer ink and provisional local ink cannot survive a drop.
      liveStrokeTransport?.clear();
      remoteStrokes.clearAll();
      remoteCursors.clear();
      drawing.abandonUncommitted();
      surface.markDirty("live");
      updateEmptyState();
    },
    onWelcome: (participant) => {
      if (roomSocket !== socket) {
        return;
      }
      selfParticipant = participant;
      selfBadge.hidden = false;
      selfBadge.textContent = participant.displayName;
      selfBadge.style.setProperty("--self-color", participant.color);
      colorInput.value = participant.color;
      drawing.setColor(participant.color);
    },
    onPresence: (participants) => {
      if (roomSocket !== socket) {
        return;
      }
      renderPresence(participants);
    },
    onStrokeLive: (message) => {
      if (roomSocket !== socket) {
        return;
      }
      const dirty = remoteStrokes.applyLive(message);
      if (dirty.liveDirty) {
        surface.markDirty("live");
      }
      updateEmptyState();
    },
    onCursor: (message) => {
      if (roomSocket !== socket) {
        return;
      }
      remoteCursors.setPosition(
        message.participantId,
        message.x,
        message.y,
        selfParticipant?.id ?? null,
      );
    },
    onSyncState: (sequenceHead, operations, _roomId, canUndo, canRedo) => {
      if (roomSocket !== socket) {
        return;
      }
      // Full snapshot/replay after join or reconnect; replaces visible set.
      committedOps.applySyncState(sequenceHead, operations);
      setHistoryButtons(canUndo, canRedo);
      surface.markDirty("committed");
      updateEmptyState();
    },
    onOperationCommitted: (operation) => {
      if (roomSocket !== socket) {
        return;
      }
      const applied = committedOps.applyCommitted(operation);
      if (applied) {
        surface.markDirty("committed");
      }
      // New commits clear the server redo branch.
      setHistoryButtons(committedOps.getOperations().length > 0, false);
      drawing.acknowledgeCommitted(operation.strokeId);
      updateEmptyState();
    },
    onHistoryChanged: (sequenceHead, operations, _roomId, canUndo, canRedo) => {
      if (roomSocket !== socket) {
        return;
      }
      committedOps.applySyncState(sequenceHead, operations);
      setHistoryButtons(canUndo, canRedo);
      surface.markDirty("committed");
      updateEmptyState();
    },
    onError: (code, message) => {
      if (roomSocket !== socket) {
        return;
      }
      // Keep Connected for recoverable stroke errors (e.g. unknown_stroke).
      if (
        code === "unknown_stroke" ||
        code === "stroke_active" ||
        code === "stroke_expired"
      ) {
        console.warn("Room error", code, message);
        return;
      }
      connectionStatus.textContent = `Error: ${code}`;
      console.warn("Room error", code, message);
    },
  });
  roomSocket = socket;
  wireDrawingNetwork(socket);
  roomSocket.connect();
}

function routeFromLocation(): void {
  const roomId = parseRoomPath(location.pathname);
  if (!roomId) {
    if (location.pathname !== "/" && location.pathname !== "") {
      history.replaceState(null, "", "/");
    }
    showLanding();
    return;
  }
  enterRoom(roomId);
}

createRoomButton.addEventListener("click", () => {
  const roomId = createRoomId();
  history.pushState(null, "", `/r/${roomId}`);
  enterRoom(roomId);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomId = joinRoomInput.value.trim().toLowerCase();
  if (!isValidRoomId(roomId)) {
    joinError.hidden = false;
    joinError.textContent = "Room id must be 8 lowercase letters or digits.";
    return;
  }
  joinError.hidden = true;
  history.pushState(null, "", `/r/${roomId}`);
  enterRoom(roomId);
});

brushButton.addEventListener("click", () => {
  setActiveTool("brush");
});

eraserButton.addEventListener("click", () => {
  setActiveTool("eraser");
});

colorInput.addEventListener("input", () => {
  drawing.setColor(colorInput.value);
});

widthInput.addEventListener("input", () => {
  drawing.setWidth(Number(widthInput.value));
  syncWidthLabel();
});

clearButton.addEventListener("click", () => {
  drawing.clearLocal();
  updateEmptyState();
});

undoButton.addEventListener("click", () => {
  if (!roomSocket?.isReady() || undoButton.disabled) {
    return;
  }
  roomSocket.sendHistoryUndo();
});

redoButton.addEventListener("click", () => {
  if (!roomSocket?.isReady() || redoButton.disabled) {
    return;
  }
  roomSocket.sendHistoryRedo();
});

new ResizeObserver(() => {
  if (!roomView.hidden) {
    resizeSurface();
  }
}).observe(stage);

window.addEventListener("popstate", () => {
  routeFromLocation();
});

routeFromLocation();
