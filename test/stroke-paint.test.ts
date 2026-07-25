import { describe, expect, it, vi } from "vitest";
import { paintStroke } from "../client/src/canvas/stroke";

function createRecordingContext(): CanvasRenderingContext2D & {
  strokeSnapshots: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }>;
} {
  const strokeSnapshots: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }> = [];

  let globalCompositeOperation: GlobalCompositeOperation = "source-over";
  let strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  let lineWidth = 1;
  const stack: Array<{
    globalCompositeOperation: GlobalCompositeOperation;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
  }> = [];

  const ctx = {
    strokeSnapshots,
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
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    save() {
      stack.push({ globalCompositeOperation, strokeStyle, lineWidth });
    },
    restore() {
      const prev = stack.pop();
      if (!prev) {
        return;
      }
      globalCompositeOperation = prev.globalCompositeOperation;
      strokeStyle = prev.strokeStyle;
      lineWidth = prev.lineWidth;
    },
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke() {
      strokeSnapshots.push({
        globalCompositeOperation,
        strokeStyle,
        lineWidth,
      });
    },
  };

  return ctx as unknown as CanvasRenderingContext2D & {
    strokeSnapshots: typeof strokeSnapshots;
  };
}

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
            { x: 10, y: 0 },
          ],
        },
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
        points: [{ x: 1, y: 1 }],
      },
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
        points: [{ x: 5, y: 5 }],
      },
      "preview",
    );
    expect(ctx.lineTo).toHaveBeenCalledWith(5.01, 5);
    expect(ctx.strokeSnapshots[0]!.globalCompositeOperation).toBe(
      "destination-out",
    );
  });
});
