import type { Point } from "./points";

export type DrawingTool = "brush" | "eraser";

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: Point[];
}

/**
 * Paint a stroke in CSS pixel space (context must already be DPR-scaled).
 * Eraser always uses destination-out (punch-through). Brush uses colour.
 * `mode` is retained for call-site clarity; eraser ignores preview styling.
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
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

  const first = stroke.points[0]!;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  if (stroke.points.length === 1) {
    // Dot / tap: short segment so lineCap rounds into a disk of `width`.
    ctx.lineTo(first.x + 0.01, first.y);
  } else {
    for (let i = 1; i < stroke.points.length; i += 1) {
      const point = stroke.points[i]!;
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
): void {
  for (const stroke of strokes) {
    paintStroke(ctx, stroke, "final");
  }
}
