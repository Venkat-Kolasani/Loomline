import type { ServerMessage } from "../../../shared/protocol";
import {
  paintStroke,
  type DrawingTool,
  type Stroke,
} from "./stroke";

export interface RemoteLiveStroke extends Stroke {
  strokeId: string;
  participantId: string;
}

/**
 * Ephemeral remote in-progress strokes for the live overlay only.
 * Finished remotes leave the live layer; durable ink arrives via operation:committed.
 */
export class RemoteStrokeStore {
  private readonly active = new Map<string, RemoteLiveStroke>();

  applyLive(
    message: Extract<ServerMessage, { type: "stroke:live" }>,
  ): { liveDirty: boolean } {
    const key = remoteKey(message.participantId, message.strokeId);

    if (message.phase === "start") {
      if (
        message.tool === undefined ||
        message.color === undefined ||
        message.width === undefined
      ) {
        return { liveDirty: false };
      }
      this.active.set(key, {
        strokeId: message.strokeId,
        participantId: message.participantId,
        tool: message.tool as DrawingTool,
        color: message.color,
        width: message.width,
        points: [...message.points],
      });
      return { liveDirty: true };
    }

    const existing = this.active.get(key);
    if (!existing) {
      return { liveDirty: false };
    }

    if (message.phase === "points") {
      existing.points = [...existing.points, ...message.points];
      return { liveDirty: true };
    }

    // phase === "end" — drop from live; committed op follows from the server.
    this.active.delete(key);
    return { liveDirty: true };
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
  }

  getActiveStrokes(): readonly RemoteLiveStroke[] {
    return [...this.active.values()];
  }

  paintLive(ctx: CanvasRenderingContext2D): void {
    for (const stroke of this.active.values()) {
      paintStroke(ctx, stroke, "preview");
    }
  }
}

export function remoteKey(participantId: string, strokeId: string): string {
  return `${participantId}:${strokeId}`;
}
