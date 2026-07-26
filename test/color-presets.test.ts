import { describe, expect, it } from "vitest";
import {
  COLOR_PRESETS,
  isColorPreset,
  normalizeHexColor,
} from "../client/src/canvas/color-presets";

describe("color presets", () => {
  it("exposes eight quick swatches including the default brush colour", () => {
    expect(COLOR_PRESETS).toHaveLength(8);
    expect(COLOR_PRESETS[0]).toBe("#0f6a5a");
  });

  it("normalizes and recognizes preset hex colours", () => {
    expect(normalizeHexColor("  #1D4ED8 ")).toBe("#1d4ed8");
    expect(isColorPreset("#1D4ED8")).toBe(true);
    expect(isColorPreset("#abcdef")).toBe(false);
    expect(normalizeHexColor("blue")).toBeNull();
  });
});
