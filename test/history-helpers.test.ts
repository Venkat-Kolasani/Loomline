import { describe, expect, it } from "vitest";
import { filterVisibleOperations } from "../worker/history";

describe("filterVisibleOperations", () => {
  it("drops tombstoned sequences while preserving order", () => {
    const ops = [
      { sequence: 1, id: "a" },
      { sequence: 2, id: "b" },
      { sequence: 3, id: "c" },
    ];
    expect(filterVisibleOperations(ops, new Set([2]))).toEqual([
      { sequence: 1, id: "a" },
      { sequence: 3, id: "c" },
    ]);
  });
});
