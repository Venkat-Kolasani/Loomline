import type { ShapeKind } from "../../../shared/protocol";
import { isShapeKind } from "../../../shared/protocol";
import type { Point } from "./points";
import { toCssPixelPoint, type CanvasSpace } from "./normalized-coords";

export type DrawingTool = "brush" | "eraser";
/** Toolbar selection: freehand tools plus geometric shapes. */
export type ActiveTool = DrawingTool | ShapeKind;

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  /** Normalized points; resolved against `space` at paint time. */
  points: Point[];
}

export interface ShapeGeometry {
  kind: ShapeKind;
  color: string;
  width: number;
  start: Point;
  end: Point;
}

/** @deprecated Prefer ShapeGeometry; rect-era name kept for call-site clarity. */
export type RectShape = Omit<ShapeGeometry, "kind"> & { kind?: "rect" };

export function isShapeTool(tool: ActiveTool): tool is ShapeKind {
  return isShapeKind(tool);
}

/**
 * Paint a stroke in CSS pixel space (context must already be DPR-scaled).
 * `space` is the canvas box as it is *now*, not the box that was active when
 * the points were captured — that is what makes replay resize-correct.
 * Stroke width stays in CSS pixels so ink keeps its physical weight.
 * Eraser always uses destination-out (punch-through). Brush uses colour.
 * `mode` is retained for call-site clarity; eraser ignores preview styling.
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  space: CanvasSpace,
  _mode: "final" | "preview" = "final",
): void {
  if (stroke.points.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;

  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }

  const first = toCssPixelPoint(stroke.points[0]!, space);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  if (stroke.points.length === 1) {
    // Dot / tap: short segment so lineCap rounds into a disk of `width`.
    ctx.lineTo(first.x + 0.01, first.y);
  } else {
    for (let i = 1; i < stroke.points.length; i += 1) {
      const point = toCssPixelPoint(stroke.points[i]!, space);
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

/** Dispatch paint for any geometric shape kind. */
export function paintShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeGeometry,
  space: CanvasSpace,
): void {
  switch (shape.kind) {
    case "rect":
      paintRect(ctx, shape, space);
      return;
    case "ellipse":
      paintEllipse(ctx, shape, space);
      return;
    case "diamond":
      paintDiamond(ctx, shape, space);
      return;
    case "triangle":
      paintTriangle(ctx, shape, space);
      return;
    case "star":
      paintStar(ctx, shape, space);
      return;
    case "line":
      paintLine(ctx, shape, space);
      return;
    case "arrow":
      paintArrow(ctx, shape, space);
      return;
    case "biarrow":
      paintBiArrow(ctx, shape, space);
      return;
  }
}

/** Axis-aligned outline from two normalized corners; width is CSS pixels. */
export function paintRect(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Straight stroke between normalized start and end. */
export function paintLine(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/** Ellipse inscribed in the bounding box of normalized start/end. */
export function paintEllipse(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (rx < 0.5 && ry < 0.5) {
    // Degenerate drag: paint a tiny circle so a tap still shows ink.
    ctx.arc(cx, cy, 0.5, 0, Math.PI * 2);
  } else {
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Line plus a triangular arrowhead at `end`. Head angle is derived from the
 * start→end vector at paint time — never stored on the operation.
 * The shaft stops at the head base so a round line-cap cannot poke past the tip.
 */
export function paintArrow(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(10, shape.width * 3.5);
  const half = Math.PI / 7;
  // Pull the shaft back to the triangle base (or mid-span for tiny arrows).
  const shaftInset = length > 0 ? Math.min(headLen, length * 0.85) : 0;
  const shaftEndX = b.x - Math.cos(angle) * shaftInset;
  const shaftEndY = b.y - Math.sin(angle) * shaftInset;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (length > 0.5) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
  }

  const leftX = b.x - headLen * Math.cos(angle - half);
  const leftY = b.y - headLen * Math.sin(angle - half);
  const rightX = b.x - headLen * Math.cos(angle + half);
  const rightY = b.y - headLen * Math.sin(angle + half);

  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Shaft with filled arrowheads at both `start` and `end`. Head angles are
 * derived at paint time; shaft is inset so round caps stay under the heads.
 */
export function paintBiArrow(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(10, shape.width * 3.5);
  const half = Math.PI / 7;
  // Cap each inset so two heads still leave a shaft on short drags.
  const shaftInset = length > 0 ? Math.min(headLen, length * 0.4) : 0;
  const shaftStartX = a.x + Math.cos(angle) * shaftInset;
  const shaftStartY = a.y + Math.sin(angle) * shaftInset;
  const shaftEndX = b.x - Math.cos(angle) * shaftInset;
  const shaftEndY = b.y - Math.sin(angle) * shaftInset;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (length > 0.5) {
    ctx.beginPath();
    ctx.moveTo(shaftStartX, shaftStartY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
  }

  fillArrowHead(ctx, b.x, b.y, angle, headLen, half);
  fillArrowHead(ctx, a.x, a.y, angle + Math.PI, headLen, half);

  ctx.restore();
}

function fillArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  headLen: number,
  half: number,
): void {
  const leftX = tipX - headLen * Math.cos(angle - half);
  const leftY = tipY - headLen * Math.sin(angle - half);
  const rightX = tipX - headLen * Math.cos(angle + half);
  const rightY = tipY - headLen * Math.sin(angle + half);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Rhombus connecting the midpoints of each side of the bounding box of
 * normalized start/end.
 */
export function paintDiamond(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(midX, minY);
  ctx.lineTo(maxX, midY);
  ctx.lineTo(midX, maxY);
  ctx.lineTo(minX, midY);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Isosceles triangle inscribed in the bounding box: apex at top-center,
 * base spanning the two bottom corners.
 */
export function paintTriangle(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const midX = (minX + maxX) / 2;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(midX, minY);
  ctx.lineTo(maxX, maxY);
  ctx.lineTo(minX, maxY);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Five-point star centered in the bounding box of normalized start/end.
 * Outer tips sit on the box; inner radius is a fixed fraction of the outer.
 */
export function paintStar(
  ctx: CanvasRenderingContext2D,
  shape: Pick<ShapeGeometry, "color" | "width" | "start" | "end">,
  space: CanvasSpace,
): void {
  const a = toCssPixelPoint(shape.start, space);
  const b = toCssPixelPoint(shape.end, space);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const outerX = Math.max(Math.abs(maxX - minX) / 2, 0.5);
  const outerY = Math.max(Math.abs(maxY - minY) / 2, 0.5);
  const innerRatio = 0.382;
  const step = Math.PI / 5;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const isOuter = i % 2 === 0;
    const rx = isOuter ? outerX : outerX * innerRatio;
    const ry = isOuter ? outerY : outerY * innerRatio;
    // Tip-up: start at -π/2.
    const angle = -Math.PI / 2 + i * step;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  space: CanvasSpace,
): void {
  for (const stroke of strokes) {
    paintStroke(ctx, stroke, space, "final");
  }
}
