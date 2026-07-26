import { describe, expect, it } from "vitest";
import {
  createToolSettings,
  widthForTool,
  withToolWidth,
} from "../client/src/canvas/tool-settings";

describe("tool settings", () => {
  it("keeps brush and eraser widths independently", () => {
    const initial = createToolSettings(4, 12);
    const updated = withToolWidth(initial, "eraser", 20);

    expect(widthForTool(updated, "brush")).toBe(4);
    expect(widthForTool(updated, "eraser")).toBe(20);
  });

  it("clamps width inputs to the renderer's supported range", () => {
    expect(createToolSettings(0, 99)).toEqual({
      brushWidth: 1,
      eraserWidth: 32,
    });
  });
});
