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
 * Local pointer drawing. Finished strokes wait on the live layer until
 * operation:committed arrives (awaitingCommit), then leave the live overlay.
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
      // Committed pixels come only from CommittedOperationStore.
      paintCommitted: () => {},
      paintLive: (ctx) => {
        for (const stroke of this.awaitingCommit) {
          paintStroke(ctx, stroke, "preview");
        }
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

  /** Drop a locally ended stroke once the server has committed it. */
  acknowledgeCommitted(strokeId: string): boolean {
    const before = this.awaitingCommit.length;
    this.awaitingCommit = this.awaitingCommit.filter(
      (stroke) => stroke.strokeId !== strokeId,
    );
    if (this.awaitingCommit.length !== before) {
      this.surface.markDirty("live");
      this.notify();
      return true;
    }
    return false;
  }

  clearLocal(): void {
    this.awaitingCommit = [];
    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markDirty("live");
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
      const willCommit = this.network?.onStrokeEnd(active.strokeId) ?? false;
      if (willCommit) {
        this.awaitingCommit = [...this.awaitingCommit, active];
      }
      // If start never reached the server, drop live ink with the stroke end.
    }

    this.active = null;
    this.drawing = false;
    this.activePointerId = null;
    this.surface.markDirty("live");
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
