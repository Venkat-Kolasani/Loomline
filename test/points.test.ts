import { describe, expect, it } from "vitest";
import {
  appendFilteredPoint,
  pointDistance,
  shouldAcceptPoint,
} from "../client/src/canvas/points";

/** 100 CSS px per normalized unit on both axes keeps the maths readable. */
const space = { cssWidth: 100, cssHeight: 100 };

describe("point filtering", () => {
  it("measures distance in CSS pixels of the current canvas box", () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 0.03, y: 0.04 }, space)).toBe(5);
  });

  it("scales the same normalized gap with the canvas box", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0.5, y: 0 };
    expect(pointDistance(a, b, { cssWidth: 200, cssHeight: 100 })).toBe(100);
    expect(pointDistance(a, b, { cssWidth: 800, cssHeight: 100 })).toBe(400);
  });

  it("always accepts the first point", () => {
    expect(shouldAcceptPoint(null, { x: 0.1, y: 0.1 }, 2, space)).toBe(true);
  });

  it("rejects points closer than the minimum distance", () => {
    expect(
      shouldAcceptPoint({ x: 0, y: 0 }, { x: 0.01, y: 0 }, 1.5, space),
    ).toBe(false);
  });

  it("accepts points at or beyond the minimum distance", () => {
    expect(
      shouldAcceptPoint({ x: 0, y: 0 }, { x: 0.015, y: 0 }, 1.5, space),
    ).toBe(true);
  });

  it("rejects non-finite coordinates", () => {
    expect(
      shouldAcceptPoint(null, { x: Number.NaN, y: 1 }, 1, space),
    ).toBe(false);
  });

  it("appends only when the filter accepts the sample", () => {
    const start = [{ x: 0, y: 0 }];
    const near = appendFilteredPoint(start, { x: 0.005, y: 0 }, 1.5, space);
    const far = appendFilteredPoint(start, { x: 0.02, y: 0 }, 1.5, space);

    expect(near).toEqual(start);
    expect(far).toEqual([
      { x: 0, y: 0 },
      { x: 0.02, y: 0 },
    ]);
  });

  it("keeps the pixel threshold meaningful on a narrow canvas", () => {
    // 0.02 of a 40px-wide phone canvas is 0.8px — below the 1.5px filter.
    const phone = { cssWidth: 40, cssHeight: 40 };
    expect(
      shouldAcceptPoint({ x: 0, y: 0 }, { x: 0.02, y: 0 }, 1.5, phone),
    ).toBe(false);
  });
});
