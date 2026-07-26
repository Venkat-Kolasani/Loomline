import {
  normalizedDistanceInCssPixels,
  type CanvasSpace,
  type NormalizedPoint,
} from "./normalized-coords";

/** Stroke points are always normalized (see `normalized-coords.ts`). */
export type Point = NormalizedPoint;

/** Distance in CSS pixels of the given canvas box. */
export function pointDistance(
  a: Point,
  b: Point,
  space: CanvasSpace,
): number {
  return normalizedDistanceInCssPixels(a, b, space);
}

/**
 * Drop near-duplicate pointer samples so strokes stay smooth without
 * flooding the point list (and later the network) with micro-moves.
 * The threshold is CSS pixels, so the filter behaves the same on a small
 * phone canvas and a wide desktop canvas.
 */
export function shouldAcceptPoint(
  previous: Point | null,
  next: Point,
  minDistance: number,
  space: CanvasSpace,
): boolean {
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) {
    return false;
  }
  if (previous === null) {
    return true;
  }
  return pointDistance(previous, next, space) >= minDistance;
}

export function appendFilteredPoint(
  points: readonly Point[],
  next: Point,
  minDistance: number,
  space: CanvasSpace,
): readonly Point[] {
  const previous = points.length > 0 ? points[points.length - 1]! : null;
  if (!shouldAcceptPoint(previous, next, minDistance, space)) {
    return points;
  }
  return [...points, next];
}
