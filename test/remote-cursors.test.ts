import { describe, expect, it } from "vitest";
import {
  getCursorEdgePlacement,
  latestLivePoint,
} from "../client/src/net/remote-cursors";

describe("remote collaborator cursor cues", () => {
  it("uses the latest streamed live point without needing a second cursor frame", () => {
    expect(latestLivePoint([])).toBeNull();
    expect(
      latestLivePoint([
        { x: 12, y: 18 },
        { x: 93, y: 41 },
      ]),
    ).toEqual({ x: 93, y: 41 });
  });

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
