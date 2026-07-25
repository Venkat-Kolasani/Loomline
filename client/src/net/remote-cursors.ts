/**
 * DOM overlays for remote cursors (ephemeral; not painted into canvas buffers).
 */

export interface CursorParticipant {
  id: string;
  displayName: string;
  color: string;
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
  }

  clear(): void {
    for (const id of [...this.cursors.keys()]) {
      this.remove(id);
    }
    this.names.clear();
    this.colors.clear();
  }
}
