import type { CanvasBackingSize } from "./sizing";
import { clientToCssPoint } from "./sizing";
import { appendFilteredPoint } from "./points";
import {
  paintStroke,
  paintStrokes,
  type DrawingTool,
  type Stroke,
} from "./stroke";
import type { LayeredCanvasSurface } from "./layers";

export interface LocalDrawingOptions {
  surface: LayeredCanvasSurface;
  liveCanvas: HTMLCanvasElement;
  minPointDistance?: number;
  onStrokesChanged?: (hasInk: boolean) => void;
}

/**
 * Local-only pointer drawing. Finished strokes live on the committed layer;
 * the in-progress stroke paints on the live overlay. No networking.
 */
export class LocalDrawingController {
  private readonly surface: LayeredCanvasSurface;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly minPointDistance: number;
  private readonly onStrokesChanged?: (hasInk: boolean) => void;

  private completed: Stroke[] = [];
  private active: Stroke | null = null;
  private drawing = false;
  private activePointerId: number | null = null;

  private tool: DrawingTool = "brush";
  private color = "#0f6a5a";
  private width = 4;

  constructor(options: LocalDrawingOptions) {
    this.surface = options.surface;
    this.liveCanvas = options.liveCanvas;
    this.minPointDistance = options.minPointDistance ?? 1.5;
    this.onStrokesChanged = options.onStrokesChanged;

    this.liveCanvas.addEventListener("pointerdown", this.onPointerDown);
    this.liveCanvas.addEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.addEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.addEventListener("pointercancel", this.onPointerUp);
    this.liveCanvas.addEventListener("lostpointercapture", this.onLostCapture);
  }

  getPainters(): {
    paintCommitted: (
      ctx: CanvasRenderingContext2D,
      size: CanvasBackingSize,
    ) => void;
    paintLive: (
      ctx: CanvasRenderingContext2D,
      size: CanvasBackingSize,
    ) => void;
  } {
    return {
      paintCommitted: (ctx) => {
        paintStrokes(ctx, this.completed);
      },
      paintLive: (ctx) => {
        if (this.active) {
          paintStroke(ctx, this.active, "preview");
        }
      },
    };
  }

  setTool(tool: DrawingTool): void {
    this.tool = tool;
  }

  setColor(color: string): void {
    this.color = color;
  }

  setWidth(width: number): void {
    const next = Math.min(32, Math.max(1, Math.round(width)));
    this.width = next;
  }

  getTool(): DrawingTool {
    return this.tool;
  }

  clearLocal(): void {
    this.completed = [];
    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markAllDirty();
    this.notify();
  }

  hasInk(): boolean {
    return this.completed.length > 0 || this.active !== null;
  }

  destroy(): void {
    this.liveCanvas.removeEventListener("pointerdown", this.onPointerDown);
    this.liveCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.removeEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.removeEventListener("pointercancel", this.onPointerUp);
    this.liveCanvas.removeEventListener("lostpointercapture", this.onLostCapture);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    if (this.drawing) {
      return;
    }

    event.preventDefault();
    try {
      this.liveCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Some environments reject capture for non-trusted events; drawing still works on-target.
    }
    this.drawing = true;
    this.activePointerId = event.pointerId;

    const point = this.toCanvasPoint(event);
    this.active = {
      tool: this.tool,
      color: this.color,
      width: this.width,
      points: [point],
    };
    this.surface.markDirty("live");
    this.notify();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId || !this.active) {
      return;
    }

    event.preventDefault();
    const point = this.toCanvasPoint(event);
    const nextPoints = appendFilteredPoint(
      this.active.points,
      point,
      this.minPointDistance,
    );
    if (nextPoints.length === this.active.points.length) {
      return;
    }

    this.active = { ...this.active, points: nextPoints };
    this.surface.markDirty("live");
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }
    event.preventDefault();
    this.finishStroke(event.pointerId);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }
    this.finishStroke(event.pointerId);
  };

  private finishStroke(pointerId: number): void {
    try {
      if (this.liveCanvas.hasPointerCapture(pointerId)) {
        this.liveCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release failures when capture was never held.
    }

    if (this.active && this.active.points.length > 0) {
      this.completed = [...this.completed, this.active];
    }

    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markAllDirty();
    this.notify();
  }

  private toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.liveCanvas.getBoundingClientRect();
    return clientToCssPoint(event.clientX, event.clientY, rect.left, rect.top);
  }

  private notify(): void {
    this.onStrokesChanged?.(this.hasInk());
  }
}
