/**
 * DOM overlays for remote cursors (ephemeral; not painted into canvas buffers).
 */

import type { StrokePoint } from "../../../shared/protocol";

const LABEL_SAFE_WIDTH = 144;
const LABEL_SAFE_HEIGHT = 42;

export interface CursorParticipant {
  id: string;
  displayName: string;
  color: string;
}

export interface CursorEdgePlacement {
  nearRight: boolean;
  nearBottom: boolean;
}

/** The last streamed point is the most accurate remote-drawing cursor source. */
export function latestLivePoint(
  points: readonly StrokePoint[],
): StrokePoint | null {
  return points.at(-1) ?? null;
}

/** Flip the DOM label before it would overflow the canvas edge. */
export function getCursorEdgePlacement(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
): CursorEdgePlacement {
  return {
    nearRight: x > containerWidth - LABEL_SAFE_WIDTH,
    nearBottom: y > containerHeight - LABEL_SAFE_HEIGHT,
  };
}

export class RemoteCursorLayer {
  private readonly root: HTMLElement;
  private readonly cursors = new Map<string, HTMLElement>();
  private readonly names = new Map<string, string>();
  private readonly colors = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  syncParticipants(participants: readonly CursorParticipant[]): void {
    const ids = new Set(participants.map((p) => p.id));
    for (const participant of participants) {
      this.names.set(participant.id, participant.displayName);
      this.colors.set(participant.id, participant.color);
    }
    for (const id of [...this.cursors.keys()]) {
      if (!ids.has(id)) {
        this.remove(id);
      }
    }
  }

  setPosition(
    participantId: string,
    x: number,
    y: number,
    selfId: string | null,
    isDrawing = false,
  ): void {
    if (selfId && participantId === selfId) {
      return;
    }
    let el = this.cursors.get(participantId);
    if (!el) {
      el = document.createElement("div");
      el.className = "remote-cursor";
      el.setAttribute("aria-hidden", "true");
      const dot = document.createElement("span");
      dot.className = "remote-cursor-dot";
      const label = document.createElement("span");
      label.className = "remote-cursor-label";
      el.appendChild(dot);
      el.appendChild(label);
      this.root.appendChild(el);
      this.cursors.set(participantId, el);
    }
    const color = this.colors.get(participantId) ?? "#334155";
    const name = this.names.get(participantId) ?? "Peer";
    el.style.setProperty("--cursor-color", color);
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.classList.toggle("is-drawing", isDrawing);
    const placement = getCursorEdgePlacement(
      x,
      y,
      this.root.clientWidth,
      this.root.clientHeight,
    );
    el.classList.toggle("is-near-right", placement.nearRight);
    el.classList.toggle("is-near-bottom", placement.nearBottom);
    const label = el.querySelector(".remote-cursor-label");
    if (label) {
      label.textContent = name;
    }
  }

  setDrawing(participantId: string, isDrawing: boolean): void {
    this.cursors.get(participantId)?.classList.toggle("is-drawing", isDrawing);
  }

  remove(participantId: string): void {
    const el = this.cursors.get(participantId);
    if (el) {
      el.remove();
      this.cursors.delete(participantId);
    }
    this.names.delete(participantId);
    this.colors.delete(participantId);
  }

  clear(): void {
    for (const id of [...this.cursors.keys()]) {
      this.remove(id);
    }
    this.names.clear();
    this.colors.clear();
  }
}
