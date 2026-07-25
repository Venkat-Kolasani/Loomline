import { LayeredCanvasSurface } from "./canvas/layers";

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

const surface = new LayeredCanvasSurface({
  committedCanvas,
  liveCanvas,
});

function resizeSurface(): void {
  const rect = stage.getBoundingClientRect();
  surface.resizeToContainer(rect.width, rect.height);
}

resizeSurface();
surface.paintNow();

const resizeObserver = new ResizeObserver(() => {
  resizeSurface();
});
resizeObserver.observe(stage);

window.addEventListener(
  "resize",
  () => {
    resizeSurface();
  },
  { passive: true },
);

connectionStatus.textContent = "Disconnected";
emptyState.hidden = false;

async function refreshConnectionPlaceholder(): Promise<void> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      connectionStatus.textContent = "Disconnected";
      return;
    }
    // Room WebSocket is not wired yet; health only proves the Worker origin.
    connectionStatus.textContent = "Disconnected";
  } catch {
    connectionStatus.textContent = "Disconnected";
  }
}

void refreshConnectionPlaceholder();
