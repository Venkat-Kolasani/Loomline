import { describe, expect, it, vi } from "vitest";
import {
  paintArrow,
  paintDiamond,
  paintEllipse,
  paintLine,
  paintRect,
  paintStroke,
  paintTriangle,
} from "../client/src/canvas/stroke";

function createRecordingContext(): CanvasRenderingContext2D & {
  strokeSnapshots: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }>;
  fillSnapshots: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
  }>;
} {
  const strokeSnapshots: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }> = [];
  const fillSnapshots: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
  }> = [];

  let globalCompositeOperation: GlobalCompositeOperation = "source-over";
  let strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  let lineWidth = 1;
  const stack: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    fillStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }> = [];

  const ctx = {
    strokeSnapshots,
    fillSnapshots,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    get globalCompositeOperation() {
      return globalCompositeOperation;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      globalCompositeOperation = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    save() {
      stack.push({
        globalCompositeOperation,
        strokeStyle,
        fillStyle,
        lineWidth,
      });
    },
    restore() {
      const prev = stack.pop();
      if (!prev) {
        return;
      }
      globalCompositeOperation = prev.globalCompositeOperation;
      strokeStyle = prev.strokeStyle;
      fillStyle = prev.fillStyle;
      lineWidth = prev.lineWidth;
    },
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    strokeRect: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    stroke() {
      strokeSnapshots.push({
        globalCompositeOperation,
        strokeStyle,
        lineWidth,
      });
    },
    fill() {
      fillSnapshots.push({ fillStyle });
    },
  };

  return ctx as unknown as CanvasRenderingContext2D & {
    strokeSnapshots: typeof strokeSnapshots;
    fillSnapshots: typeof fillSnapshots;
  };
}

const space = { cssWidth: 100, cssHeight: 100 };

describe("paintStroke eraser", () => {
  it("uses destination-out for eraser in final and preview modes", () => {
    for (const mode of ["final", "preview"] as const) {
      const ctx = createRecordingContext();
      paintStroke(
        ctx,
        {
          tool: "eraser",
          color: "#ff0000",
          width: 12,
          points: [
            { x: 0, y: 0 },
            { x: 0.1, y: 0 },
          ],
        },
        space,
        mode,
      );
      expect(ctx.strokeSnapshots).toHaveLength(1);
      expect(ctx.strokeSnapshots[0]!.globalCompositeOperation).toBe(
        "destination-out",
      );
      expect(ctx.strokeSnapshots[0]!.lineWidth).toBe(12);
    }
  });

  it("applies brush colour with source-over", () => {
    const ctx = createRecordingContext();
    paintStroke(
      ctx,
      {
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        points: [{ x: 0.01, y: 0.01 }],
      },
      space,
      "preview",
    );
    expect(ctx.strokeSnapshots[0]!.globalCompositeOperation).toBe("source-over");
    expect(ctx.strokeSnapshots[0]!.strokeStyle).toBe("#0f6a5a");
    expect(ctx.strokeSnapshots[0]!.lineWidth).toBe(4);
  });

  it("draws a short segment for a single-point eraser tap", () => {
    const ctx = createRecordingContext();
    paintStroke(
      ctx,
      {
        tool: "eraser",
        color: "#000",
        width: 8,
        points: [{ x: 0.05, y: 0.05 }],
      },
      space,
      "preview",
    );
    expect(ctx.lineTo).toHaveBeenCalledWith(5.01, 5);
    expect(ctx.strokeSnapshots[0]!.globalCompositeOperation).toBe(
      "destination-out",
    );
  });
});

describe("paintStroke coordinate space", () => {
  const stroke = {
    tool: "brush" as const,
    color: "#0f6a5a",
    width: 4,
    points: [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
  };

  it("resolves normalized points against the canvas box given at paint time", () => {
    const ctx = createRecordingContext();
    paintStroke(ctx, stroke, { cssWidth: 800, cssHeight: 400 }, "final");

    expect(ctx.moveTo).toHaveBeenCalledWith(200, 200);
    expect(ctx.lineTo).toHaveBeenCalledWith(600, 200);
  });

  it("reflows the same stroke when the canvas is resized or rotated", () => {
    const landscape = createRecordingContext();
    paintStroke(landscape, stroke, { cssWidth: 800, cssHeight: 400 }, "final");

    const portrait = createRecordingContext();
    paintStroke(portrait, stroke, { cssWidth: 400, cssHeight: 800 }, "final");

    // Same fractions of the box, so the ink keeps its relative placement.
    expect(portrait.moveTo).toHaveBeenCalledWith(100, 400);
    expect(portrait.lineTo).toHaveBeenCalledWith(300, 400);
    // Width stays in CSS pixels: ink weight does not shrink with the canvas.
    expect(portrait.strokeSnapshots[0]!.lineWidth).toBe(
      landscape.strokeSnapshots[0]!.lineWidth,
    );
  });

  it("keeps a zero-sized canvas finite instead of painting NaN", () => {
    const ctx = createRecordingContext();
    paintStroke(ctx, stroke, { cssWidth: 0, cssHeight: 0 }, "final");

    expect(ctx.moveTo).toHaveBeenCalledWith(0.25, 0.5);
  });
});

describe("shape paint geometry", () => {
  const corners = {
    color: "#1d4ed8",
    width: 4,
    start: { x: 0.2, y: 0.25 },
    end: { x: 0.8, y: 0.75 },
  };

  it("paintRect strokes the axis-aligned box of start/end", () => {
    const ctx = createRecordingContext();
    paintRect(ctx, corners, space);
    // geometry only — style is restored after paintRect
    expect(ctx.strokeRect).toHaveBeenCalledWith(20, 25, 60, 50);
  });

  it("paintLine draws a straight segment from start to end", () => {
    const ctx = createRecordingContext();
    paintLine(ctx, corners, space);
    expect(ctx.moveTo).toHaveBeenCalledWith(20, 25);
    expect(ctx.lineTo).toHaveBeenCalledWith(80, 75);
    expect(ctx.strokeSnapshots).toHaveLength(1);
  });

  it("paintEllipse draws an ellipse inscribed in the bounding box", () => {
    const ctx = createRecordingContext();
    paintEllipse(ctx, corners, space);
    expect(ctx.ellipse).toHaveBeenCalledWith(50, 50, 30, 25, 0, 0, Math.PI * 2);
    expect(ctx.strokeSnapshots).toHaveLength(1);
  });

  it("paintArrow draws a shaft and a filled head derived from the vector", () => {
    const ctx = createRecordingContext();
    paintArrow(
      ctx,
      {
        color: "#be123c",
        width: 4,
        start: { x: 0.1, y: 0.5 },
        end: { x: 0.9, y: 0.5 },
      },
      space,
    );
    // Shaft ends at the head base (inset by headLen), not the tip — otherwise
    // a round line-cap would poke past the triangle.
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 50);
    expect(ctx.lineTo).toHaveBeenCalledWith(76, 50);
    expect(ctx.strokeSnapshots).toHaveLength(1);
    expect(ctx.fillSnapshots).toHaveLength(1);
    expect(ctx.fillSnapshots[0]!.fillStyle).toBe("#be123c");
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it("paintDiamond connects midpoints of the bounding-box sides", () => {
    const ctx = createRecordingContext();
    paintDiamond(ctx, corners, space);
    // corners: (20,25)-(80,75) → mid top (50,25), right (80,50), bottom (50,75), left (20,50)
    expect(ctx.moveTo).toHaveBeenCalledWith(50, 25);
    expect(ctx.lineTo).toHaveBeenCalledWith(80, 50);
    expect(ctx.lineTo).toHaveBeenCalledWith(50, 75);
    expect(ctx.lineTo).toHaveBeenCalledWith(20, 50);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.strokeSnapshots).toHaveLength(1);
  });

  it("paintTriangle uses top-center apex and bottom-corner base", () => {
    const ctx = createRecordingContext();
    paintTriangle(ctx, corners, space);
    // corners: (20,25)-(80,75) → apex (50,25), base (80,75) and (20,75)
    expect(ctx.moveTo).toHaveBeenCalledWith(50, 25);
    expect(ctx.lineTo).toHaveBeenCalledWith(80, 75);
    expect(ctx.lineTo).toHaveBeenCalledWith(20, 75);
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.strokeSnapshots).toHaveLength(1);
  });
});
