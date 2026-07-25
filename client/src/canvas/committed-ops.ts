import type { CommittedOperation } from "../../../shared/protocol";
import { paintStroke, type Stroke } from "./stroke";

/**
 * Server-authoritative committed strokes, keyed by sequence.
 * Rebuilds the committed canvas only when the visible op set changes.
 */
export class CommittedOperationStore {
  private readonly bySequence = new Map<number, CommittedOperation>();
  private head = 0;

  applySyncState(
    sequenceHead: number,
    operations: readonly CommittedOperation[],
  ): boolean {
    this.bySequence.clear();
    for (const op of operations) {
      this.bySequence.set(op.sequence, op);
    }
    this.head = sequenceHead;
    return true;
  }

  /** Returns true when a new sequence was applied (committed layer dirty). */
  applyCommitted(operation: CommittedOperation): boolean {
    if (this.bySequence.has(operation.sequence)) {
      return false;
    }
    this.bySequence.set(operation.sequence, operation);
    if (operation.sequence > this.head) {
      this.head = operation.sequence;
    }
    return true;
  }

  clear(): void {
    this.bySequence.clear();
    this.head = 0;
  }

  getSequenceHead(): number {
    return this.head;
  }

  getOperations(): CommittedOperation[] {
    return [...this.bySequence.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  hasStrokeId(strokeId: string): boolean {
    for (const op of this.bySequence.values()) {
      if (op.strokeId === strokeId) {
        return true;
      }
    }
    return false;
  }

  paint(ctx: CanvasRenderingContext2D): void {
    for (const op of this.getOperations()) {
      const stroke: Stroke = {
        tool: op.tool,
        color: op.color,
        width: op.width,
        points: op.points,
      };
      paintStroke(ctx, stroke, "final");
    }
  }
}
