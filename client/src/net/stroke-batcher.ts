import type { StrokePoint } from "../../../shared/protocol";

export interface StrokeBatchHandlers {
  sendPoints: (strokeId: string, points: StrokePoint[]) => void;
}

/**
 * Batches outgoing stroke points to at most one WebSocket send per
 * requestAnimationFrame. Local rendering stays independent and immediate.
 */
export class StrokePointBatcher {
  private readonly handlers: StrokeBatchHandlers;
  private pendingStrokeId: string | null = null;
  private pendingPoints: StrokePoint[] = [];
  private rafHandle: number | null = null;

  constructor(handlers: StrokeBatchHandlers) {
    this.handlers = handlers;
  }

  /** Queue points for the active stroke; flush schedules one rAF tick. */
  enqueue(strokeId: string, points: readonly StrokePoint[]): void {
    if (points.length === 0) {
      return;
    }
    if (this.pendingStrokeId && this.pendingStrokeId !== strokeId) {
      this.flushNow();
    }
    this.pendingStrokeId = strokeId;
    this.pendingPoints.push(...points);
    this.scheduleFlush();
  }

  /** Flush any pending batch immediately (e.g. before stroke:end). */
  flushNow(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.flushPending();
  }

  clear(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.pendingStrokeId = null;
    this.pendingPoints = [];
  }

  private scheduleFlush(): void {
    if (this.rafHandle !== null) {
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.flushPending();
    });
  }

  private flushPending(): void {
    const strokeId = this.pendingStrokeId;
    if (!strokeId || this.pendingPoints.length === 0) {
      this.pendingStrokeId = null;
      this.pendingPoints = [];
      return;
    }
    const points = this.pendingPoints;
    this.pendingStrokeId = null;
    this.pendingPoints = [];
    this.handlers.sendPoints(strokeId, points);
  }
}
