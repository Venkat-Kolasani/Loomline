import type { StrokePoint } from "../../../shared/protocol";
import type { LocalStrokeStartEvent } from "../canvas/local-drawing";
import { StrokePointBatcher } from "./stroke-batcher";

export interface LiveStrokeTransportSink {
  isReady: () => boolean;
  sendStrokeStart: (event: LocalStrokeStartEvent) => void;
  sendStrokePoints: (strokeId: string, points: StrokePoint[]) => void;
  sendStrokeEnd: (strokeId: string, point?: StrokePoint) => void;
}

/**
 * Ensures points/end are only sent for strokes whose stroke:start was accepted
 * while the socket was ready. Prevents unknown_stroke after a Connecting… race
 * where start was dropped but later batches still flushed.
 */
export class LiveStrokeTransport {
  private readonly sink: LiveStrokeTransportSink;
  private readonly batcher: StrokePointBatcher;
  /** Strokes that successfully sent stroke:start on this connection. */
  private readonly acceptedStarts = new Set<string>();

  constructor(sink: LiveStrokeTransportSink) {
    this.sink = sink;
    this.batcher = new StrokePointBatcher({
      sendPoints: (strokeId, points) => {
        if (!this.acceptedStarts.has(strokeId) || !this.sink.isReady()) {
          return;
        }
        this.sink.sendStrokePoints(strokeId, points);
      },
    });
  }

  onStrokeStart(event: LocalStrokeStartEvent): void {
    if (!this.sink.isReady()) {
      // Local ink may continue; do not mark accepted — suppress points/end.
      return;
    }
    this.batcher.flushNow();
    this.sink.sendStrokeStart(event);
    this.acceptedStarts.add(event.strokeId);
  }

  onStrokePoints(strokeId: string, points: StrokePoint[]): void {
    if (!this.acceptedStarts.has(strokeId)) {
      return;
    }
    this.batcher.enqueue(strokeId, points);
  }

  /**
   * @returns true when stroke:end was sent (client should await operation:committed).
   */
  onStrokeEnd(strokeId: string, point?: StrokePoint): boolean {
    if (!this.acceptedStarts.has(strokeId)) {
      // Start was never accepted (e.g. Connecting…); no durable op will arrive.
      return false;
    }
    this.batcher.flushNow();
    if (!this.sink.isReady()) {
      this.acceptedStarts.delete(strokeId);
      return false;
    }
    this.sink.sendStrokeEnd(strokeId, point);
    this.acceptedStarts.delete(strokeId);
    return true;
  }

  clear(): void {
    this.batcher.clear();
    this.acceptedStarts.clear();
  }
}
