import type { ServerMessage } from "../../../shared/protocol";
import {
  paintStroke,
  paintStrokes,
  type DrawingTool,
  type Stroke,
} from "./stroke";

export interface RemoteLiveStroke extends Stroke {
  strokeId: string;
  participantId: string;
}

/**
 * Ephemeral remote in-progress strokes for the live overlay.
 * Finished remote strokes are retained provisionally on the committed painter
 * until durable operation:committed exists (next slice) — they are NOT
 * server-sequenced yet.
 */
export class RemoteStrokeStore {
  private readonly active = new Map<string, RemoteLiveStroke>();
  private provisionalFinished: Stroke[] = [];

  applyLive(
    message: Extract<ServerMessage, { type: "stroke:live" }>,
  ): { liveDirty: boolean; committedDirty: boolean } {
    const key = remoteKey(message.participantId, message.strokeId);

    if (message.phase === "start") {
      if (
        message.tool === undefined ||
        message.color === undefined ||
        message.width === undefined
      ) {
        return { liveDirty: false, committedDirty: false };
      }
      this.active.set(key, {
        strokeId: message.strokeId,
        participantId: message.participantId,
        tool: message.tool as DrawingTool,
        color: message.color,
        width: message.width,
        points: [...message.points],
      });
      return { liveDirty: true, committedDirty: false };
    }

    const existing = this.active.get(key);
    if (!existing) {
      return { liveDirty: false, committedDirty: false };
    }

    if (message.phase === "points") {
      existing.points = [...existing.points, ...message.points];
      return { liveDirty: true, committedDirty: false };
    }

    // phase === "end"
    if (message.points.length > 0) {
      existing.points = [...existing.points, ...message.points];
    }
    this.active.delete(key);
    if (existing.points.length > 0) {
      this.provisionalFinished = [
        ...this.provisionalFinished,
        {
          tool: existing.tool,
          color: existing.color,
          width: existing.width,
          points: existing.points,
        },
      ];
      return { liveDirty: true, committedDirty: true };
    }
    return { liveDirty: true, committedDirty: false };
  }

  clearParticipant(participantId: string): { liveDirty: boolean } {
    let liveDirty = false;
    for (const [key, stroke] of [...this.active.entries()]) {
      if (stroke.participantId === participantId) {
        this.active.delete(key);
        liveDirty = true;
      }
    }
    return { liveDirty };
  }

  clearAll(): void {
    this.active.clear();
    this.provisionalFinished = [];
  }

  getActiveStrokes(): readonly RemoteLiveStroke[] {
    return [...this.active.values()];
  }

  getProvisionalFinished(): readonly Stroke[] {
    return this.provisionalFinished;
  }

  paintLive(ctx: CanvasRenderingContext2D): void {
    for (const stroke of this.active.values()) {
      paintStroke(ctx, stroke, "preview");
    }
  }

  paintProvisionalCommitted(ctx: CanvasRenderingContext2D): void {
    paintStrokes(ctx, this.provisionalFinished);
  }
}

export function remoteKey(participantId: string, strokeId: string): string {
  return `${participantId}:${strokeId}`;
}
