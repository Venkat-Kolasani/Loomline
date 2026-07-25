import type { StrokePoint } from "../../../shared/protocol";
import type { CanvasBackingSize } from "./sizing";
import { clientToCssPoint } from "./sizing";
import { appendFilteredPoint, type Point } from "./points";
import {
  paintStroke,
  paintStrokes,
  type DrawingTool,
  type Stroke,
} from "./stroke";
import type { LayeredCanvasSurface } from "./layers";

export interface LocalStrokeStartEvent {
  strokeId: string;
  tool: DrawingTool;
  color: string;
  width: number;
  point: StrokePoint;
}

export interface LocalDrawingNetworkHooks {
  onStrokeStart: (event: LocalStrokeStartEvent) => void;
  onStrokePoints: (strokeId: string, points: StrokePoint[]) => void;
  onStrokeEnd: (strokeId: string, point?: StrokePoint) => void;
  onCursor: (point: StrokePoint) => void;
}

export interface LocalDrawingOptions {
  surface: LayeredCanvasSurface;
  liveCanvas: HTMLCanvasElement;
  minPointDistance?: number;
  onStrokesChanged?: (hasInk: boolean) => void;
  network?: LocalDrawingNetworkHooks;
}

interface ActiveStroke extends Stroke {
  strokeId: string;
}

/**
 * Local pointer drawing with optional network hooks.
 * Local pixels paint immediately; network point batches are owned by the caller
 * (typically one stroke:points send per animation frame).
 */
export class LocalDrawingController {
  private readonly surface: LayeredCanvasSurface;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly minPointDistance: number;
  private readonly onStrokesChanged?: (hasInk: boolean) => void;
  private network?: LocalDrawingNetworkHooks;

  private completed: Stroke[] = [];
  private active: ActiveStroke | null = null;
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
    this.network = options.network;

    this.liveCanvas.addEventListener("pointerdown", this.onPointerDown);
    this.liveCanvas.addEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.addEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.addEventListener("pointercancel", this.onPointerUp);
    this.liveCanvas.addEventListener("lostpointercapture", this.onLostCapture);
  }

  setNetworkHooks(network: LocalDrawingNetworkHooks | undefined): void {
    this.network = network;
  }

  getPainters(): {
    paintCommitted: (
      ctx: CanvasRenderingContext2D,
      _size: CanvasBackingSize,
    ) => void;
    paintLive: (
      ctx: CanvasRenderingContext2D,
      _size: CanvasBackingSize,
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
    this.width = Math.min(32, Math.max(1, Math.round(width)));
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
    const strokeId = crypto.randomUUID();
    this.active = {
      strokeId,
      tool: this.tool,
      color: this.color,
      width: this.width,
      points: [point],
    };
    this.surface.markDirty("live");
    this.notify();
    this.network?.onStrokeStart({
      strokeId,
      tool: this.tool,
      color: this.color,
      width: this.width,
      point,
    });
    this.network?.onCursor(point);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.toCanvasPoint(event);
    this.network?.onCursor(point);

    if (!this.drawing || event.pointerId !== this.activePointerId || !this.active) {
      return;
    }

    event.preventDefault();
    const nextPoints = appendFilteredPoint(
      this.active.points,
      point,
      this.minPointDistance,
    );
    if (nextPoints.length === this.active.points.length) {
      return;
    }

    this.active.points = nextPoints as Point[];
    this.surface.markDirty("live");
    this.network?.onStrokePoints(this.active.strokeId, [point]);
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

    const active = this.active;
    if (active && active.points.length > 0) {
      this.completed = [...this.completed, active];
      this.network?.onStrokeEnd(active.strokeId);
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
