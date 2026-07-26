import type { Point } from "./points";
import { toCssPixelPoint, type CanvasSpace } from "./normalized-coords";

export type DrawingTool = "brush" | "eraser";
/** Toolbar selection: freehand tools plus axis-aligned rectangle. */
export type ActiveTool = DrawingTool | "rect";

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  /** Normalized points; resolved against `space` at paint time. */
  points: Point[];
}

export interface RectShape {
  color: string;
  width: number;
  start: Point;
  end: Point;
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

/** Axis-aligned outline from two normalized corners; width is CSS pixels. */
export function paintRect(
  ctx: CanvasRenderingContext2D,
  shape: RectShape,
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

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  space: CanvasSpace,
): void {
  for (const stroke of strokes) {
    paintStroke(ctx, stroke, space, "final");
  }
}
