import { describe, expect, it } from "vitest";
import {
  createToolSettings,
  eraserPresetIdForWidth,
  snapEraserWidth,
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

  it("clamps brush width and snaps eraser width to presets", () => {
    expect(createToolSettings(0, 99)).toEqual({
      brushWidth: 1,
      eraserWidth: 32,
    });
    expect(snapEraserWidth(7)).toBe(6);
    expect(snapEraserWidth(14)).toBe(12);
    expect(snapEraserWidth(25)).toBe(20);
    expect(eraserPresetIdForWidth(20)).toBe("l");
  });
});
