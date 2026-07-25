/**
 * Developer-only runtime diagnostics (`?debug=1`).
 * FPS is measured from rAF deltas only while the panel is active — not a
 * permanent render loop for the canvas.
 */

export function isDebugEnabled(search: string = location.search): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

export function withDebugQuery(path: string): string {
  if (!isDebugEnabled()) {
    return path;
  }
  const url = new URL(path, location.origin);
  url.searchParams.set("debug", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface DiagnosticsSnapshot {
  fps: number | null;
  rttMs: number | null;
  inboundPerSec: number;
  outboundPerSec: number;
  participants: number;
  sequenceHead: number;
}

export class DiagnosticsPanel {
  private readonly root: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly rttEl: HTMLElement;
  private readonly inEl: HTMLElement;
  private readonly outEl: HTMLElement;
  private readonly presenceEl: HTMLElement;
  private readonly seqEl: HTMLElement;

  private inboundWindow = 0;
  private outboundWindow = 0;
  private inboundPerSec = 0;
  private outboundPerSec = 0;
  private participants = 0;
  private sequenceHead = 0;
  private rttMs: number | null = null;
  private fps: number | null = null;

  private lastFrameAt: number | null = null;
  private fpsAccumMs = 0;
  private fpsFrames = 0;
  private rafId: number | null = null;
  private rateTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sendPing: (() => void) | null = null;

  constructor() {
    this.root = document.createElement("aside");
    this.root.id = "debug-panel";
    this.root.className = "debug-panel";
    this.root.setAttribute("aria-label", "Developer diagnostics");
    this.root.innerHTML = `
      <h2 class="debug-heading">Diagnostics</h2>
      <dl class="debug-metrics">
        <div><dt>rAF FPS</dt><dd data-metric="fps">—</dd></div>
        <div><dt>WS RTT</dt><dd data-metric="rtt">—</dd></div>
        <div><dt>Inbound /s</dt><dd data-metric="in">0</dd></div>
        <div><dt>Outbound /s</dt><dd data-metric="out">0</dd></div>
        <div><dt>Participants</dt><dd data-metric="presence">0</dd></div>
        <div><dt>Sequence head</dt><dd data-metric="seq">0</dd></div>
      </dl>
      <p class="debug-note">Measured locally. Not a SLA claim.</p>
    `;
    document.body.appendChild(this.root);

    this.fpsEl = this.root.querySelector('[data-metric="fps"]')!;
    this.rttEl = this.root.querySelector('[data-metric="rtt"]')!;
    this.inEl = this.root.querySelector('[data-metric="in"]')!;
    this.outEl = this.root.querySelector('[data-metric="out"]')!;
    this.presenceEl = this.root.querySelector('[data-metric="presence"]')!;
    this.seqEl = this.root.querySelector('[data-metric="seq"]')!;
  }

  start(sendPing: () => void): void {
    this.sendPing = sendPing;
    this.stopTimers();
    this.rateTimer = setInterval(() => {
      this.inboundPerSec = this.inboundWindow;
      this.outboundPerSec = this.outboundWindow;
      this.inboundWindow = 0;
      this.outboundWindow = 0;
      this.render();
    }, 1_000);
    this.pingTimer = setInterval(() => {
      this.sendPing?.();
    }, 2_000);
    this.sendPing();
    this.scheduleFps();
    this.render();
  }

  stop(): void {
    this.stopTimers();
    this.sendPing = null;
    this.lastFrameAt = null;
    this.fps = null;
    this.rttMs = null;
    this.render();
  }

  noteInbound(): void {
    this.inboundWindow += 1;
  }

  noteOutbound(): void {
    this.outboundWindow += 1;
  }

  setParticipants(count: number): void {
    this.participants = count;
    this.render();
  }

  setSequenceHead(head: number): void {
    this.sequenceHead = head;
    this.render();
  }

  notePong(clientTime: number): void {
    this.rttMs = Math.max(0, performance.now() - clientTime);
    this.render();
  }

  snapshot(): DiagnosticsSnapshot {
    return {
      fps: this.fps,
      rttMs: this.rttMs,
      inboundPerSec: this.inboundPerSec,
      outboundPerSec: this.outboundPerSec,
      participants: this.participants,
      sequenceHead: this.sequenceHead,
    };
  }

  private scheduleFps(): void {
    if (this.rafId !== null) {
      return;
    }
    const tick = (now: number): void => {
      this.rafId = null;
      if (this.lastFrameAt !== null) {
        const delta = now - this.lastFrameAt;
        this.fpsAccumMs += delta;
        this.fpsFrames += 1;
        if (this.fpsAccumMs >= 500) {
          this.fps = (this.fpsFrames * 1000) / this.fpsAccumMs;
          this.fpsAccumMs = 0;
          this.fpsFrames = 0;
          this.render();
        }
      }
      this.lastFrameAt = now;
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTimers(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.rateTimer !== null) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private render(): void {
    this.fpsEl.textContent =
      this.fps === null ? "—" : `${this.fps.toFixed(1)}`;
    this.rttEl.textContent =
      this.rttMs === null ? "—" : `${this.rttMs.toFixed(1)} ms`;
    this.inEl.textContent = String(this.inboundPerSec);
    this.outEl.textContent = String(this.outboundPerSec);
    this.presenceEl.textContent = String(this.participants);
    this.seqEl.textContent = String(this.sequenceHead);
  }
}
