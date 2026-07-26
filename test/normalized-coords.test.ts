import { describe, expect, it } from "vitest";
import {
  normalizedDistanceInCssPixels,
  toCssPixelPoint,
  toNormalizedPoint,
} from "../client/src/canvas/normalized-coords";

describe("normalized coordinate space", () => {
  it("converts a CSS pixel sample into a fraction of the canvas box", () => {
    expect(
      toNormalizedPoint({ x: 240, y: 90 }, { cssWidth: 960, cssHeight: 360 }),
    ).toEqual({ x: 0.25, y: 0.25 });
  });

  it("round-trips through the same box", () => {
    const space = { cssWidth: 733, cssHeight: 411 };
    const pixel = { x: 512.5, y: 100.25 };
    const back = toCssPixelPoint(toNormalizedPoint(pixel, space), space);

    expect(back.x).toBeCloseTo(pixel.x, 10);
    expect(back.y).toBeCloseTo(pixel.y, 10);
  });

  it("resolves a stored point against whatever box is current", () => {
    const stored = toNormalizedPoint(
      { x: 400, y: 300 },
      { cssWidth: 800, cssHeight: 600 },
    );

    expect(toCssPixelPoint(stored, { cssWidth: 400, cssHeight: 900 })).toEqual({
      x: 200,
      y: 450,
    });
  });

  it("does not clamp samples captured outside the box", () => {
    // Pointer capture keeps reporting moves past the canvas edge; clamping
    // would bend the stroke along the border instead of letting it leave.
    expect(
      toNormalizedPoint({ x: -20, y: 120 }, { cssWidth: 100, cssHeight: 100 }),
    ).toEqual({ x: -0.2, y: 1.2 });
  });

  it("treats a zero or invalid extent as 1 so results stay finite", () => {
    expect(
      toNormalizedPoint({ x: 5, y: 5 }, { cssWidth: 0, cssHeight: Number.NaN }),
    ).toEqual({ x: 5, y: 5 });
  });

  it("measures normalized gaps in CSS pixels", () => {
    expect(
      normalizedDistanceInCssPixels(
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { cssWidth: 60, cssHeight: 80 },
      ),
    ).toBe(50);
  });
});
