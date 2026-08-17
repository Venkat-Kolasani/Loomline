/**
 * DOM overlays for remote cursors (ephemeral; not painted into canvas buffers).
 * Positions arrive normalized (see `canvas/normalized-coords.ts`) and are
 * resolved to CSS pixels against the overlay box that is current at paint time,
 * so peer cursors and labels reflow with the canvas on resize / rotation.
 */

import {
  toCssPixelPoint,
  type NormalizedPoint,
} from "../canvas/normalized-coords";

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
  /** Last known normalized position per participant, for resize reflow. */
  private readonly positions = new Map<string, NormalizedPoint>();

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

  /** `x` / `y` are normalized fractions of the overlay box, not pixels. */
  setPosition(
    participantId: string,
    x: number,
    y: number,
    selfId: string | null,
  ): void {
    if (selfId && participantId === selfId) {
      return;
    }
    this.positions.set(participantId, { x, y });
    this.place(participantId);
  }

  /**
   * Re-place every cursor against the current overlay box. Cursor traffic is
   * event-driven, so without this an idle peer's pointer would keep stale pixels
   * after a resize until they moved again.
   */
  refresh(): void {
    for (const participantId of this.cursors.keys()) {
      this.place(participantId);
    }
  }

  private place(participantId: string): void {
    const normalized = this.positions.get(participantId);
    if (!normalized) {
      return;
    }
    let el = this.cursors.get(participantId);
    if (!el) {
      el = document.createElement("div");
      el.className = "remote-cursor";
      el.setAttribute("aria-hidden", "true");
      const pointer = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      pointer.classList.add("remote-cursor-pointer");
      pointer.setAttribute("viewBox", "0 0 24 24");
      pointer.setAttribute("focusable", "false");
      const pointerShape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      pointerShape.setAttribute("d", "M3 2.5 20.5 12 12.2 14.2 8.5 22Z");
      pointer.appendChild(pointerShape);
      const label = document.createElement("span");
      label.className = "remote-cursor-label";
      el.appendChild(pointer);
      el.appendChild(label);
      this.root.appendChild(el);
      this.cursors.set(participantId, el);
    }
    const color = this.colors.get(participantId) ?? "#334155";
    const name = this.names.get(participantId) ?? "Peer";
    const containerWidth = this.root.clientWidth;
    const containerHeight = this.root.clientHeight;
    const pixel = toCssPixelPoint(normalized, {
      cssWidth: containerWidth,
      cssHeight: containerHeight,
    });
    el.style.setProperty("--cursor-color", color);
    el.style.transform = `translate(${pixel.x}px, ${pixel.y}px)`;
    const placement = getCursorEdgePlacement(
      pixel.x,
      pixel.y,
      containerWidth,
      containerHeight,
    );
    el.classList.toggle("is-near-right", placement.nearRight);
    el.classList.toggle("is-near-bottom", placement.nearBottom);
    const label = el.querySelector(".remote-cursor-label");
    if (label) {
      label.textContent = name;
    }
  }

  remove(participantId: string): void {
    const el = this.cursors.get(participantId);
    if (el) {
      el.remove();
      this.cursors.delete(participantId);
    }
    this.names.delete(participantId);
    this.colors.delete(participantId);
    this.positions.delete(participantId);
  }

  clear(): void {
    for (const id of [...this.cursors.keys()]) {
      this.remove(id);
    }
    this.names.clear();
    this.colors.clear();
    this.positions.clear();
  }
}
