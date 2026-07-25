import type { Point } from "./points";

export type DrawingTool = "brush" | "eraser";

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: Point[];
}

/** Paint a stroke in CSS pixel space (context must already be DPR-scaled). */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  mode: "final" | "preview" = "final",
): void {
  if (stroke.points.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;

  if (stroke.tool === "eraser") {
    if (mode === "preview") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(120, 130, 140, 0.45)";
    } else {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0, 0, 0, 1)";
    }
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }

  const first = stroke.points[0]!;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  if (stroke.points.length === 1) {
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
