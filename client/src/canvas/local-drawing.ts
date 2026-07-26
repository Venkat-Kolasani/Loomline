import type { StrokePoint } from "../../../shared/protocol";
import type { CanvasBackingSize } from "./sizing";
import { clientToCssPoint } from "./sizing";
import { appendFilteredPoint, type Point } from "./points";
import {
  paintStroke,
  type DrawingTool,
  type Stroke,
} from "./stroke";
import type { LayeredCanvasSurface } from "./layers";
import { retainProvisionalEraser } from "./eraser-retain";

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
  /** Return true when the server will emit operation:committed for this stroke. */
  onStrokeEnd: (strokeId: string, point?: StrokePoint) => boolean;
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
 * Local pointer drawing. Brush waits on the live layer until committed.
 * Eraser punches through on the committed view while provisional (active /
 * awaiting-commit), then the store owns the hole after acknowledge.
 */
export class LocalDrawingController {
  private readonly surface: LayeredCanvasSurface;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly minPointDistance: number;
  private readonly onStrokesChanged?: (hasInk: boolean) => void;
  private network?: LocalDrawingNetworkHooks;

  /** Own strokes ended locally but not yet confirmed by the server. */
  private awaitingCommit: ActiveStroke[] = [];
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

  getTool(): DrawingTool {
    return this.tool;
  }

  getWidth(): number {
    return this.width;
  }

  /** Brush-only live overlay (eraser paints on the committed pass). */
  paintLiveBrush(
    ctx: CanvasRenderingContext2D,
    _size?: CanvasBackingSize,
  ): void {
    for (const stroke of this.awaitingCommit) {
      if (stroke.tool === "brush") {
        paintStroke(ctx, stroke, "preview");
      }
    }
    if (this.active?.tool === "brush") {
      paintStroke(ctx, this.active, "preview");
    }
  }

  /** Provisional eraser holes over committed ink (destination-out). */
  paintProvisionalErasers(ctx: CanvasRenderingContext2D): void {
    for (const stroke of this.awaitingCommit) {
      if (stroke.tool === "eraser") {
        paintStroke(ctx, stroke, "final");
      }
    }
    if (this.active?.tool === "eraser") {
      paintStroke(ctx, this.active, "final");
    }
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
        this.paintProvisionalErasers(ctx);
      },
      paintLive: (ctx, size) => {
        this.paintLiveBrush(ctx, size);
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

  /**
   * Drop a locally ended stroke once the server has committed it.
   * Erasers with a shorter committed point list stay provisional so the hole
   * cannot shrink (ink "growing back") when the last points batch was lost.
   */
  acknowledgeCommitted(
    strokeId: string,
    committedPointCount?: number,
  ): boolean {
    const removed = this.awaitingCommit.find((s) => s.strokeId === strokeId);
    if (!removed) {
      return false;
    }
    if (
      removed.tool === "eraser" &&
      committedPointCount !== undefined &&
      retainProvisionalEraser(removed.points.length, committedPointCount)
    ) {
      return false;
    }
    this.awaitingCommit = this.awaitingCommit.filter(
      (stroke) => stroke.strokeId !== strokeId,
    );
    this.markStrokeLayersDirty(removed.tool);
    this.notify();
    return true;
  }

  /** Drop awaiting-commit ink (history/sync replaces the committed view). */
  dropAwaitingCommit(): void {
    if (this.awaitingCommit.length === 0) {
      return;
    }
    const hadEraser = this.awaitingCommit.some((s) => s.tool === "eraser");
    const hadBrush = this.awaitingCommit.some((s) => s.tool === "brush");
    this.awaitingCommit = [];
    if (hadEraser) {
      this.surface.markDirty("committed");
    }
    if (hadBrush) {
      this.surface.markDirty("live");
    }
    this.notify();
  }

  clearLocal(): void {
    this.awaitingCommit = [];
    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markAllDirty();
    this.notify();
  }

  /**
   * Drop active + awaiting-commit local ink after disconnect/reconnect.
   * Those strokes will not receive operation:committed on the new socket.
   */
  abandonUncommitted(): void {
    this.clearLocal();
  }

  hasInk(): boolean {
    return this.awaitingCommit.length > 0 || this.active !== null;
  }

  private markStrokeLayersDirty(tool: DrawingTool): void {
    if (tool === "eraser") {
      this.surface.markDirty("committed");
    } else {
      this.surface.markDirty("live");
    }
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
    this.markStrokeLayersDirty(this.tool);
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
    // Skip cursor while drawing so live stroke batches stay the only
    // in-flight pointer traffic (bandwidth / peer overlay clarity).
    if (!this.drawing) {
      this.network?.onCursor(point);
    }

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
    this.markStrokeLayersDirty(this.active.tool);
    this.network?.onStrokePoints(this.active.strokeId, [point]);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }
    event.preventDefault();
    this.finishStroke(event.pointerId, event);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }
    this.finishStroke(event.pointerId, event);
  };

  private finishStroke(pointerId: number, endEvent?: PointerEvent): void {
    try {
      if (this.liveCanvas.hasPointerCapture(pointerId)) {
        this.liveCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release failures when capture was never held.
    }

    const active = this.active;
    if (active && active.points.length > 0) {
      let endPoint: StrokePoint | undefined;
      if (endEvent) {
        const tip = this.toCanvasPoint(endEvent);
        const nextPoints = appendFilteredPoint(
          active.points,
          tip,
          this.minPointDistance,
        );
        if (nextPoints.length !== active.points.length) {
          active.points = nextPoints as Point[];
          endPoint = tip;
        }
      }
      const willCommit =
        this.network?.onStrokeEnd(active.strokeId, endPoint) ?? false;
      if (willCommit) {
        this.awaitingCommit = [...this.awaitingCommit, active];
      }
      // If start never reached the server, drop live ink with the stroke end.
    }

    const tool = active?.tool ?? this.tool;
    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.markStrokeLayersDirty(tool);
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
