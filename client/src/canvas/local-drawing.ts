import type { StrokePoint } from "../../../shared/protocol";
import { clientToCssPoint } from "./sizing";
import {
  toNormalizedPoint,
  type CanvasSpace,
  type NormalizedPoint,
} from "./normalized-coords";
import { appendFilteredPoint, type Point } from "./points";
import {
  paintRect,
  paintStroke,
  type ActiveTool,
  type DrawingTool,
  type RectShape,
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

export interface LocalRectCommitEvent {
  shapeId: string;
  color: string;
  width: number;
  start: StrokePoint;
  end: StrokePoint;
}

export interface LocalDrawingNetworkHooks {
  onStrokeStart: (event: LocalStrokeStartEvent) => void;
  onStrokePoints: (strokeId: string, points: StrokePoint[]) => void;
  /** Return true when the server will emit operation:committed for this stroke. */
  onStrokeEnd: (strokeId: string, point?: StrokePoint) => boolean;
  /**
   * Commit one finished rectangle. Return true when the server will emit
   * operation:committed (keeps a local provisional until then).
   */
  onShapeRect: (event: LocalRectCommitEvent) => boolean;
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

interface ActiveRect extends RectShape {
  shapeId: string;
}

/**
 * Local pointer drawing. Brush waits on the live layer until committed.
 * Eraser punches through on the committed view while provisional (active /
 * awaiting-commit), then the store owns the hole after acknowledge.
 * Rectangle drag is local-preview only until pointer-up commits one op.
 */
export class LocalDrawingController {
  private readonly surface: LayeredCanvasSurface;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly minPointDistance: number;
  private readonly onStrokesChanged?: (hasInk: boolean) => void;
  private network?: LocalDrawingNetworkHooks;

  /** Own strokes ended locally but not yet confirmed by the server. */
  private awaitingCommit: ActiveStroke[] = [];
  private awaitingRectCommit: ActiveRect[] = [];
  private active: ActiveStroke | null = null;
  private activeRect: ActiveRect | null = null;
  private drawing = false;
  private activePointerId: number | null = null;

  private tool: ActiveTool = "brush";
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

  getTool(): ActiveTool {
    return this.tool;
  }

  getWidth(): number {
    return this.width;
  }

  /** Brush + rect live overlay (eraser paints on the committed pass). */
  paintLiveBrush(ctx: CanvasRenderingContext2D, space: CanvasSpace): void {
    for (const stroke of this.awaitingCommit) {
      if (stroke.tool === "brush") {
        paintStroke(ctx, stroke, space, "preview");
      }
    }
    if (this.active?.tool === "brush") {
      paintStroke(ctx, this.active, space, "preview");
    }
    for (const rect of this.awaitingRectCommit) {
      paintRect(ctx, rect, space);
    }
    if (this.activeRect) {
      paintRect(ctx, this.activeRect, space);
    }
  }

  /** Provisional eraser holes over committed ink (destination-out). */
  paintProvisionalErasers(
    ctx: CanvasRenderingContext2D,
    space: CanvasSpace,
  ): void {
    for (const stroke of this.awaitingCommit) {
      if (stroke.tool === "eraser") {
        paintStroke(ctx, stroke, space, "final");
      }
    }
    if (this.active?.tool === "eraser") {
      paintStroke(ctx, this.active, space, "final");
    }
  }

  getPainters(): {
    paintCommitted: (
      ctx: CanvasRenderingContext2D,
      space: CanvasSpace,
    ) => void;
    paintLive: (ctx: CanvasRenderingContext2D, space: CanvasSpace) => void;
  } {
    return {
      paintCommitted: (ctx, space) => {
        this.paintProvisionalErasers(ctx, space);
      },
      paintLive: (ctx, space) => {
        this.paintLiveBrush(ctx, space);
      },
    };
  }

  setTool(tool: ActiveTool): void {
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

  /** Drop a locally ended rectangle once the server has committed it. */
  acknowledgeRectCommitted(shapeId: string): boolean {
    const removed = this.awaitingRectCommit.find((r) => r.shapeId === shapeId);
    if (!removed) {
      return false;
    }
    this.awaitingRectCommit = this.awaitingRectCommit.filter(
      (rect) => rect.shapeId !== shapeId,
    );
    this.surface.markDirty("live");
    this.notify();
    return true;
  }

  /** Drop awaiting-commit ink (history/sync replaces the committed view). */
  dropAwaitingCommit(): void {
    const hadStroke = this.awaitingCommit.length > 0;
    const hadRect = this.awaitingRectCommit.length > 0;
    if (!hadStroke && !hadRect) {
      return;
    }
    const hadEraser = this.awaitingCommit.some((s) => s.tool === "eraser");
    const hadBrush = this.awaitingCommit.some((s) => s.tool === "brush");
    this.awaitingCommit = [];
    this.awaitingRectCommit = [];
    if (hadEraser) {
      this.surface.markDirty("committed");
    }
    if (hadBrush || hadRect) {
      this.surface.markDirty("live");
    }
    this.notify();
  }

  clearLocal(): void {
    this.awaitingCommit = [];
    this.awaitingRectCommit = [];
    this.active = null;
    this.activeRect = null;
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
    return (
      this.awaitingCommit.length > 0 ||
      this.awaitingRectCommit.length > 0 ||
      this.active !== null ||
      this.activeRect !== null
    );
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

    const { point } = this.samplePointer(event);

    if (this.tool === "rect") {
      const shapeId = crypto.randomUUID();
      this.activeRect = {
        shapeId,
        color: this.color,
        width: this.width,
        start: point,
        end: point,
      };
      this.surface.markDirty("live");
      this.notify();
      this.network?.onCursor(point);
      return;
    }

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
    const { point, space } = this.samplePointer(event);
    // Skip cursor while drawing so live stroke batches stay the only
    // in-flight pointer traffic (bandwidth / peer overlay clarity).
    if (!this.drawing) {
      this.network?.onCursor(point);
    }

    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }

    event.preventDefault();

    if (this.activeRect) {
      // Local preview only — no network frames while dragging a rectangle.
      this.activeRect = { ...this.activeRect, end: point };
      this.surface.markDirty("live");
      return;
    }

    if (!this.active) {
      return;
    }

    const nextPoints = appendFilteredPoint(
      this.active.points,
      point,
      this.minPointDistance,
      space,
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
    this.finishPointer(event.pointerId, event);
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.activePointerId) {
      return;
    }
    this.finishPointer(event.pointerId, event);
  };

  private finishPointer(pointerId: number, endEvent?: PointerEvent): void {
    try {
      if (this.liveCanvas.hasPointerCapture(pointerId)) {
        this.liveCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release failures when capture was never held.
    }

    if (this.activeRect) {
      this.finishRect(endEvent);
      return;
    }

    this.finishStroke(endEvent);
  }

  private finishRect(endEvent?: PointerEvent): void {
    const active = this.activeRect;
    if (active && endEvent) {
      const { point } = this.samplePointer(endEvent);
      active.end = point;
    }

    if (active) {
      const willCommit =
        this.network?.onShapeRect({
          shapeId: active.shapeId,
          color: active.color,
          width: active.width,
          start: active.start,
          end: active.end,
        }) ?? false;
      if (willCommit) {
        this.awaitingRectCommit = [...this.awaitingRectCommit, active];
      }
    }

    this.activeRect = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markDirty("live");
    this.notify();
  }

  private finishStroke(endEvent?: PointerEvent): void {
    const active = this.active;
    if (active && active.points.length > 0) {
      let endPoint: StrokePoint | undefined;
      if (endEvent) {
        const { point: tip, space } = this.samplePointer(endEvent);
        const nextPoints = appendFilteredPoint(
          active.points,
          tip,
          this.minPointDistance,
          space,
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

    const tool = active?.tool ?? (this.tool === "rect" ? "brush" : this.tool);
    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.markStrokeLayersDirty(tool);
    this.notify();
  }

  /**
   * One `getBoundingClientRect` per pointer event yields both the normalized
   * point and the canvas box it was normalized against, so the CSS-pixel
   * distance filter stays consistent with the sample.
   */
  private samplePointer(event: PointerEvent): {
    point: NormalizedPoint;
    space: CanvasSpace;
  } {
    const rect = this.liveCanvas.getBoundingClientRect();
    const cssPoint = clientToCssPoint(
      event.clientX,
      event.clientY,
      rect.left,
      rect.top,
    );
    const space: CanvasSpace = {
      cssWidth: rect.width,
      cssHeight: rect.height,
    };
    return { point: toNormalizedPoint(cssPoint, space), space };
  }

  private notify(): void {
    this.onStrokesChanged?.(this.hasInk());
  }
}
