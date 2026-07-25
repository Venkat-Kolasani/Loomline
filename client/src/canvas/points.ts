export interface Point {
  x: number;
  y: number;
}

/** Euclidean distance in CSS pixel space. */
export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Drop near-duplicate pointer samples so strokes stay smooth without
 * flooding the point list (and later the network) with micro-moves.
 */
export function shouldAcceptPoint(
  previous: Point | null,
  next: Point,
  minDistance: number,
): boolean {
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) {
    return false;
  }
  if (previous === null) {
    return true;
  }
  return pointDistance(previous, next) >= minDistance;
}

export function appendFilteredPoint(
  points: readonly Point[],
  next: Point,
  minDistance: number,
): Point[] {
  const previous = points.length > 0 ? points[points.length - 1]! : null;
  if (!shouldAcceptPoint(previous, next, minDistance)) {
    return points.slice();
  }
  return [...points, next];
}
