/**
 * Pure canvas sizing and coordinate helpers.
 * Drawing uses CSS pixel space after the 2D context is scaled by devicePixelRatio.
 */

export interface CanvasBackingSize {
  cssWidth: number;
  cssHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  dpr: number;
}

export function normalizeDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) {
    return 1;
  }
  return dpr;
}

export function computeBackingSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): CanvasBackingSize {
  const safeDpr = normalizeDpr(dpr);
  const width = Math.max(0, cssWidth);
  const height = Math.max(0, cssHeight);

  return {
    cssWidth: width,
    cssHeight: height,
    bufferWidth: Math.max(1, Math.round(width * safeDpr)),
    bufferHeight: Math.max(1, Math.round(height * safeDpr)),
    dpr: safeDpr,
  };
}

/**
 * Map a viewport client point into CSS coordinates relative to a canvas box.
 * Use this when the context transform is already scaled by DPR.
 */
export function clientToCssPoint(
  clientX: number,
  clientY: number,
  canvasLeft: number,
  canvasTop: number,
): { x: number; y: number } {
  return {
    x: clientX - canvasLeft,
    y: clientY - canvasTop,
  };
}

export function applyBackingSize(
  canvas: HTMLCanvasElement,
  size: CanvasBackingSize,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable.");
  }

  canvas.width = size.bufferWidth;
  canvas.height = size.bufferHeight;
  canvas.style.width = `${size.cssWidth}px`;
  canvas.style.height = `${size.cssHeight}px`;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return ctx;
}
