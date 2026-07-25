import { describe, expect, it } from "vitest";
import {
  appendFilteredPoint,
  pointDistance,
  shouldAcceptPoint,
} from "../client/src/canvas/points";

describe("point filtering", () => {
  it("measures distance between points", () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("always accepts the first point", () => {
    expect(shouldAcceptPoint(null, { x: 10, y: 10 }, 2)).toBe(true);
  });

  it("rejects points closer than the minimum distance", () => {
    expect(
      shouldAcceptPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, 1.5),
    ).toBe(false);
  });

  it("accepts points at or beyond the minimum distance", () => {
    expect(
      shouldAcceptPoint({ x: 0, y: 0 }, { x: 1.5, y: 0 }, 1.5),
    ).toBe(true);
  });

  it("rejects non-finite coordinates", () => {
    expect(
      shouldAcceptPoint(null, { x: Number.NaN, y: 1 }, 1),
    ).toBe(false);
  });

  it("appends only when the filter accepts the sample", () => {
    const start = [{ x: 0, y: 0 }];
    const near = appendFilteredPoint(start, { x: 0.5, y: 0 }, 1.5);
    const far = appendFilteredPoint(start, { x: 2, y: 0 }, 1.5);

    expect(near).toEqual(start);
    expect(far).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });
});
