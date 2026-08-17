import { describe, expect, it } from "vitest";
import { getCursorEdgePlacement } from "../client/src/net/remote-cursors";

describe("remote collaborator cursor cues", () => {
  it("flips the label only near a canvas edge", () => {
    expect(getCursorEdgePlacement(120, 90, 320, 200)).toEqual({
      nearRight: false,
      nearBottom: false,
    });
    expect(getCursorEdgePlacement(177, 159, 320, 200)).toEqual({
      nearRight: true,
      nearBottom: true,
    });
  });
});
