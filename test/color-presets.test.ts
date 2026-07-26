import { describe, expect, it } from "vitest";
import {
  COLOR_PRESETS,
  isColorPreset,
  normalizeHexColor,
} from "../client/src/canvas/color-presets";

describe("color presets", () => {
  it("exposes five quick swatches including the default brush colour", () => {
    expect(COLOR_PRESETS).toHaveLength(5);
    expect(COLOR_PRESETS).toContain("#0f6a5a");
    expect(COLOR_PRESETS).toEqual([
      "#111827",
      "#0f6a5a",
      "#1d4ed8",
      "#be123c",
      "#b45309",
    ]);
  });

  it("normalizes and recognizes preset hex colours", () => {
    expect(normalizeHexColor("  #1D4ED8 ")).toBe("#1d4ed8");
    expect(isColorPreset("#1D4ED8")).toBe(true);
    expect(isColorPreset("#abcdef")).toBe(false);
    expect(normalizeHexColor("blue")).toBeNull();
  });
});
