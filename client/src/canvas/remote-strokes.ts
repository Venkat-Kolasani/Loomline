import type { ServerMessage } from "../../../shared/protocol";
import {
  paintStroke,
  type DrawingTool,
  type Stroke,
} from "./stroke";
import { retainProvisionalEraser } from "./eraser-retain";

export interface RemoteLiveStroke extends Stroke {
  strokeId: string;
  participantId: string;
}

/**
 * Ephemeral remote in-progress strokes.
 * Brush paints on the live overlay; eraser punches on the committed view.
 */
export class RemoteStrokeStore {
  private readonly active = new Map<string, RemoteLiveStroke>();

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
      const tool = message.tool as DrawingTool;
      this.active.set(key, {
        strokeId: message.strokeId,
        participantId: message.participantId,
        tool,
        color: message.color,
        width: message.width,
        points: [...message.points],
      });
      return dirtyForTool(tool);
    }

    const existing = this.active.get(key);
    if (!existing) {
      return { liveDirty: false, committedDirty: false };
    }

    if (message.phase === "points") {
      existing.points = [...existing.points, ...message.points];
      return dirtyForTool(existing.tool);
    }

    // phase === "end" — brush leaves live; eraser stays provisional until
    // operation:committed (avoids a one-frame hole flash of restored ink).
    // Append any trailing end-point so the provisional hole matches commit.
    if (message.points.length > 0) {
      existing.points = [...existing.points, ...message.points];
    }
    if (existing.tool === "eraser") {
      return message.points.length > 0
        ? dirtyForTool("eraser")
        : { liveDirty: false, committedDirty: false };
    }
    this.active.delete(key);
    return dirtyForTool("brush");
  }

  /**
   * Drop a remote live/provisional stroke after the server commits it.
   * When `committedPointCount` is set for an eraser and is shorter than the
   * provisional path, keep the provisional hole (ink must not grow back).
   */
  removeStroke(
    participantId: string,
    strokeId: string,
    committedPointCount?: number,
  ): { liveDirty: boolean; committedDirty: boolean } {
    const key = remoteKey(participantId, strokeId);
    const existing = this.active.get(key);
    if (!existing) {
      return { liveDirty: false, committedDirty: false };
    }
    if (
      existing.tool === "eraser" &&
      committedPointCount !== undefined &&
      retainProvisionalEraser(existing.points.length, committedPointCount)
    ) {
      return { liveDirty: false, committedDirty: false };
    }
    this.active.delete(key);
    return dirtyForTool(existing.tool);
  }

  clearParticipant(participantId: string): {
    liveDirty: boolean;
    committedDirty: boolean;
  } {
    let liveDirty = false;
    let committedDirty = false;
    for (const [key, stroke] of [...this.active.entries()]) {
      if (stroke.participantId === participantId) {
        this.active.delete(key);
        if (stroke.tool === "eraser") {
          committedDirty = true;
        } else {
          liveDirty = true;
        }
      }
    }
    return { liveDirty, committedDirty };
  }

  clearAll(): void {
    this.active.clear();
  }

  /** Drop provisional erasers after history/sync (store is source of truth). */
  clearProvisionalErasers(): boolean {
    let removed = false;
    for (const [key, stroke] of [...this.active.entries()]) {
      if (stroke.tool === "eraser") {
        this.active.delete(key);
        removed = true;
      }
    }
    return removed;
  }

  getActiveStrokes(): readonly RemoteLiveStroke[] {
    return [...this.active.values()];
  }

  /** Brush-only live overlay. */
  paintLive(ctx: CanvasRenderingContext2D): void {
    for (const stroke of this.active.values()) {
      if (stroke.tool === "brush") {
        paintStroke(ctx, stroke, "preview");
      }
    }
  }

  /** Remote in-progress erasers punch through committed ink. */
  paintProvisionalErasers(ctx: CanvasRenderingContext2D): void {
    for (const stroke of this.active.values()) {
      if (stroke.tool === "eraser") {
        paintStroke(ctx, stroke, "final");
      }
    }
  }
}

function dirtyForTool(tool: DrawingTool): {
  liveDirty: boolean;
  committedDirty: boolean;
} {
  if (tool === "eraser") {
    return { liveDirty: false, committedDirty: true };
  }
  return { liveDirty: true, committedDirty: false };
}

export function remoteKey(participantId: string, strokeId: string): string {
  return `${participantId}:${strokeId}`;
}
