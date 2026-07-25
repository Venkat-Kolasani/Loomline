import { LayeredCanvasSurface } from "./canvas/layers";
import { LocalDrawingController } from "./canvas/local-drawing";
import type { DrawingTool } from "./canvas/stroke";
import { RoomSocket } from "./net/room-socket";
import type { Participant } from "../../shared/room";
import { createRoomId, isValidRoomId } from "../../shared/room";

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
const widthValue = requireElement(
  "#tool-width-value",
  (node): node is HTMLElement => node instanceof HTMLElement,
);

let drawing!: LocalDrawingController;
let roomSocket: RoomSocket | null = null;
let selfParticipant: Participant | null = null;

const surface = new LayeredCanvasSurface({
  committedCanvas,
  liveCanvas,
  paintCommitted: (ctx, size) => {
    drawing.getPainters().paintCommitted(ctx, size);
  },
  paintLive: (ctx, size) => {
    drawing.getPainters().paintLive(ctx, size);
  },
});

drawing = new LocalDrawingController({
  surface,
  liveCanvas,
  onStrokesChanged: (hasInk) => {
    emptyState.hidden = hasInk;
  },
});

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

function showLanding(): void {
  roomSocket?.disconnect();
  roomSocket = null;
  landingView.hidden = false;
  roomView.hidden = true;
  document.title = "Loomline";
}

function renderPresence(participants: Participant[]): void {
  presenceList.replaceChildren();
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
}

function enterRoom(roomId: string): void {
  landingView.hidden = true;
  roomView.hidden = false;
  document.title = `Loomline · ${roomId}`;
  roomTitle.textContent = `Room ${roomId}`;
  const shareUrl = `${location.origin}/r/${roomId}`;
  roomLink.href = shareUrl;
  roomLink.textContent = shareUrl;
  connectionStatus.textContent = "Connecting…";
  selfBadge.hidden = true;
  renderPresence([]);

  drawing.setColor(colorInput.value);
  drawing.setWidth(Number(widthInput.value));
  setActiveTool("brush");
  syncWidthLabel();
  resizeSurface();
  surface.paintNow();
  emptyState.hidden = drawing.hasInk();

  roomSocket?.disconnect();
  roomSocket = new RoomSocket(roomId, {
    onConnectionState: (state) => {
      if (state === "connecting") {
        connectionStatus.textContent = "Connecting…";
      } else if (state === "connected") {
        connectionStatus.textContent = "Connected";
      } else if (state === "error") {
        connectionStatus.textContent = "Connection error";
      } else {
        connectionStatus.textContent = "Disconnected";
      }
    },
    onWelcome: (participant) => {
      selfParticipant = participant;
      selfBadge.hidden = false;
      selfBadge.textContent = participant.displayName;
      selfBadge.style.setProperty("--self-color", participant.color);
      colorInput.value = participant.color;
      drawing.setColor(participant.color);
    },
    onPresence: (participants) => {
      renderPresence(participants);
    },
    onError: (code, message) => {
      connectionStatus.textContent = `Error: ${code}`;
      console.warn("Room error", code, message);
    },
  });
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
