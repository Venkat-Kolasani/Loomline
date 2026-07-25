import { describe, expect, it } from "vitest";
import { CommittedOperationStore } from "../client/src/canvas/committed-ops";
import type { CommittedOperation } from "../shared/protocol";

function op(sequence: number, strokeId: string): CommittedOperation {
  return {
    sequence,
    opId: `op-${sequence}`,
    participantId: "p1",
    strokeId,
    tool: "brush",
    color: "#0f6a5a",
    width: 4,
    points: [
      { x: sequence, y: sequence },
      { x: sequence + 1, y: sequence + 1 },
    ],
    createdAt: sequence * 1000,
  };
}

describe("CommittedOperationStore", () => {
  it("applies sync_state and ignores duplicate sequences", () => {
    const store = new CommittedOperationStore();
    store.applySyncState(2, [op(1, "a"), op(2, "b")]);
    expect(store.getSequenceHead()).toBe(2);
    expect(store.getOperations().map((o) => o.strokeId)).toEqual(["a", "b"]);

    expect(store.applyCommitted(op(2, "b"))).toBe(false);
    expect(store.applyCommitted(op(3, "c"))).toBe(true);
    expect(store.getSequenceHead()).toBe(3);
    expect(store.getOperations().map((o) => o.sequence)).toEqual([1, 2, 3]);
  });

  it("keeps server sequence order for overlapping strokes", () => {
    const store = new CommittedOperationStore();
    // Intentionally apply out of arrival order relative to local time.
    store.applyCommitted(op(2, "top"));
    store.applyCommitted(op(1, "bottom"));
    expect(store.getOperations().map((o) => o.strokeId)).toEqual([
      "bottom",
      "top",
    ]);
  });
});
