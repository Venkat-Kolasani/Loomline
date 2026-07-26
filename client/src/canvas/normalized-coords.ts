/**
 * Normalized canvas coordinate space.
 *
 * Every point that is stored in a stroke, persisted as an operation, or sent
 * over the WebSocket is a fraction of the canvas box: `x` in width units and
 * `y` in height units, where `1` is the right/bottom edge. Pixels only exist
 * at two boundaries: the pointer event that produced a point, and the paint
 * call that consumes it. Both boundaries use the canvas size that is current
 * at that moment, so a replayed operation log follows the canvas when the
 * window is resized or the device is rotated.
 *
 * Values are not clamped to `[0, 1]`: pointer capture legitimately reports
 * samples just outside the box, and clamping would bend the stroke along the
 * edge instead of letting it leave the visible area.
 */

/** A point in the durable/wire space: fractions of the canvas box. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** A point in CSS pixels relative to the canvas box origin. */
export interface CssPixelPoint {
  x: number;
  y: number;
}

/** The CSS pixel box a normalized point is resolved against. */
export interface CanvasSpace {
  cssWidth: number;
  cssHeight: number;
}

/**
 * Guard against a zero-sized canvas (hidden room view, first frame before
 * layout) so normalization returns finite numbers instead of Infinity/NaN.
 */
function safeExtent(extent: number): number {
  if (!Number.isFinite(extent) || extent <= 0) {
    return 1;
  }
  return extent;
}

export function toNormalizedPoint(
  point: CssPixelPoint,
  space: CanvasSpace,
): NormalizedPoint {
  return {
    x: point.x / safeExtent(space.cssWidth),
    y: point.y / safeExtent(space.cssHeight),
  };
}

export function toCssPixelPoint(
  point: NormalizedPoint,
  space: CanvasSpace,
): CssPixelPoint {
  return {
    x: point.x * safeExtent(space.cssWidth),
    y: point.y * safeExtent(space.cssHeight),
  };
}

/**
 * Distance between two normalized points measured in CSS pixels of `space`.
 * Input filtering and hit thresholds stay in pixel units because they describe
 * what a human hand does, not what fraction of the canvas it covers.
 */
export function normalizedDistanceInCssPixels(
  a: NormalizedPoint,
  b: NormalizedPoint,
  space: CanvasSpace,
): number {
  return Math.hypot(
    (a.x - b.x) * safeExtent(space.cssWidth),
    (a.y - b.y) * safeExtent(space.cssHeight),
  );
}
