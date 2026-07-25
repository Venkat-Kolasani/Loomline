import { describe, expect, it } from "vitest";
import {
  clientToCssPoint,
  computeBackingSize,
  normalizeDpr,
} from "../client/src/canvas/sizing";

describe("canvas sizing helpers", () => {
  it("normalizes invalid DPR values to 1", () => {
    expect(normalizeDpr(Number.NaN)).toBe(1);
    expect(normalizeDpr(0)).toBe(1);
    expect(normalizeDpr(-2)).toBe(1);
    expect(normalizeDpr(2.5)).toBe(2.5);
  });

  it("computes backing buffer size from CSS box and DPR", () => {
    expect(computeBackingSize(200, 100, 2)).toEqual({
      cssWidth: 200,
      cssHeight: 100,
      bufferWidth: 400,
      bufferHeight: 200,
      dpr: 2,
    });
  });

  it("clamps empty CSS boxes to a 1x1 buffer", () => {
    expect(computeBackingSize(0, 0, 3)).toEqual({
      cssWidth: 0,
      cssHeight: 0,
      bufferWidth: 1,
      bufferHeight: 1,
      dpr: 3,
    });
  });

  it("maps client coordinates into CSS canvas space", () => {
    expect(clientToCssPoint(150, 80, 100, 40)).toEqual({ x: 50, y: 40 });
  });
});
