import { LayeredCanvasSurface } from "./canvas/layers";
import { LocalDrawingController } from "./canvas/local-drawing";
import type { DrawingTool } from "./canvas/stroke";

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

// Created after `surface` so painters can close over `drawing`.
let drawing!: LocalDrawingController;

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

drawing.setColor(colorInput.value);
drawing.setWidth(Number(widthInput.value));
setActiveTool("brush");
syncWidthLabel();

resizeSurface();
surface.paintNow();

new ResizeObserver(() => {
  resizeSurface();
}).observe(stage);

// Room WebSocket is not wired yet.
connectionStatus.textContent = "Disconnected";
emptyState.hidden = false;
