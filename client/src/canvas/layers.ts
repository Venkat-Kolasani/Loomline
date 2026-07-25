import {
  applyBackingSize,
  computeBackingSize,
  type CanvasBackingSize,
} from "./sizing";

export type CanvasLayerId = "committed" | "live";

export type LayerPainter = (
  ctx: CanvasRenderingContext2D,
  size: CanvasBackingSize,
) => void;

export interface LayeredCanvasOptions {
  committedCanvas: HTMLCanvasElement;
  liveCanvas: HTMLCanvasElement;
  paintCommitted?: LayerPainter;
  paintLive?: LayerPainter;
  getDpr?: () => number;
}

/**
 * Two-layer canvas controller.
 * - committed: reserved for deterministic replay of server-sequenced ops
 * - live: reserved for ephemeral local/remote in-progress strokes
 * Layers never share pixel buffers. Paint runs only when a layer is dirty.
 */
export class LayeredCanvasSurface {
  private readonly committedCanvas: HTMLCanvasElement;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly paintCommitted: LayerPainter;
  private readonly paintLive: LayerPainter;
  private readonly getDpr: () => number;

  private committedCtx: CanvasRenderingContext2D | null = null;
  private liveCtx: CanvasRenderingContext2D | null = null;
  private size: CanvasBackingSize | null = null;

  private dirtyCommitted = true;
  private dirtyLive = true;
  private rafHandle: number | null = null;

  constructor(options: LayeredCanvasOptions) {
    this.committedCanvas = options.committedCanvas;
    this.liveCanvas = options.liveCanvas;
    this.paintCommitted = options.paintCommitted ?? clearLayer;
    this.paintLive = options.paintLive ?? clearLayer;
    this.getDpr = options.getDpr ?? (() => window.devicePixelRatio || 1);
  }

  getSize(): CanvasBackingSize | null {
    return this.size;
  }

  markDirty(layer: CanvasLayerId): void {
    if (layer === "committed") {
      this.dirtyCommitted = true;
    } else {
      this.dirtyLive = true;
    }
    this.schedulePaint();
  }

  markAllDirty(): void {
    this.dirtyCommitted = true;
    this.dirtyLive = true;
    this.schedulePaint();
  }

  resizeToContainer(cssWidth: number, cssHeight: number): void {
    const next = computeBackingSize(cssWidth, cssHeight, this.getDpr());
    const prev = this.size;
    if (
      prev &&
      prev.cssWidth === next.cssWidth &&
      prev.cssHeight === next.cssHeight &&
      prev.dpr === next.dpr
    ) {
      return;
    }

    this.size = next;
    this.committedCtx = applyBackingSize(this.committedCanvas, next);
    this.liveCtx = applyBackingSize(this.liveCanvas, next);
    this.markAllDirty();
  }

  /** Immediate paint of dirty layers; cancels a pending rAF tick. */
  paintNow(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.flushDirtyLayers();
  }

  destroy(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private schedulePaint(): void {
    if (this.rafHandle !== null) {
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.flushDirtyLayers();
    });
  }

  private flushDirtyLayers(): void {
    const size = this.size;
    if (!size || !this.committedCtx || !this.liveCtx) {
      return;
    }

    if (this.dirtyCommitted) {
      clearLayer(this.committedCtx, size);
      this.paintCommitted(this.committedCtx, size);
      this.dirtyCommitted = false;
    }

    if (this.dirtyLive) {
      clearLayer(this.liveCtx, size);
      this.paintLive(this.liveCtx, size);
      this.dirtyLive = false;
    }
  }
}

function clearLayer(
  ctx: CanvasRenderingContext2D,
  size: CanvasBackingSize,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.bufferWidth, size.bufferHeight);
  ctx.restore();
}
