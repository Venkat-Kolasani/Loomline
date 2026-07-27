import {
  isShapeOperation,
  type CommittedOperation,
} from "../../../shared/protocol";
import type { CanvasSpace } from "./normalized-coords";
import { paintShape, paintStroke, type Stroke } from "./stroke";

/**
 * Server-authoritative committed operations, keyed by sequence.
 * Tracks every applied sequence so reconnect/duplicate events never double-paint.
 */
export class CommittedOperationStore {
  private readonly bySequence = new Map<number, CommittedOperation>();
  /** Sequences already observed (survives undo visibility changes). */
  private readonly appliedSequences = new Set<number>();
  private head = 0;

  applySyncState(
    sequenceHead: number,
    operations: readonly CommittedOperation[],
  ): boolean {
    this.bySequence.clear();
    for (const op of operations) {
      this.bySequence.set(op.sequence, op);
      this.appliedSequences.add(op.sequence);
    }
    this.head = Math.max(this.head, sequenceHead);
    for (const op of operations) {
      if (op.sequence > this.head) {
        this.head = op.sequence;
      }
    }
    return true;
  }

  /**
   * Returns true when a new sequence was applied (committed layer dirty).
   * Duplicate sequences are ignored (reconnect / late fan-out).
   */
  applyCommitted(operation: CommittedOperation): boolean {
    if (this.appliedSequences.has(operation.sequence)) {
      return false;
    }
    this.appliedSequences.add(operation.sequence);
    this.bySequence.set(operation.sequence, operation);
    if (operation.sequence > this.head) {
      this.head = operation.sequence;
    }
    return true;
  }

  clear(): void {
    this.bySequence.clear();
    this.appliedSequences.clear();
    this.head = 0;
  }

  getSequenceHead(): number {
    return this.head;
  }

  getLastAppliedSequence(): number {
    return this.head;
  }

  hasAppliedSequence(sequence: number): boolean {
    return this.appliedSequences.has(sequence);
  }

  getOperations(): CommittedOperation[] {
    return [...this.bySequence.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  hasStrokeId(strokeId: string): boolean {
    for (const op of this.bySequence.values()) {
      if (op.kind === "stroke" && op.strokeId === strokeId) {
        return true;
      }
    }
    return false;
  }

  hasShapeId(shapeId: string): boolean {
    for (const op of this.bySequence.values()) {
      if (isShapeOperation(op) && op.shapeId === shapeId) {
        return true;
      }
    }
    return false;
  }

  /** Deterministic replay against the canvas box that is current right now. */
  paint(ctx: CanvasRenderingContext2D, space: CanvasSpace): void {
    for (const op of this.getOperations()) {
      if (op.kind === "clear") {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        continue;
      }
      if (isShapeOperation(op)) {
        paintShape(
          ctx,
          {
            kind: op.kind,
            color: op.color,
            width: op.width,
            start: op.start,
            end: op.end,
          },
          space,
        );
        continue;
      }
      const stroke: Stroke = {
        tool: op.tool,
        color: op.color,
        width: op.width,
        points: op.points,
      };
      paintStroke(ctx, stroke, space, "final");
    }
  }
}
