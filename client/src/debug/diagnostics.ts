/**
 * Demo metrics dock (collapsed by default on the canvas corner).
 * Display rAF rate is sampled from rAF deltas only while the dock is expanded —
 * not a permanent canvas paint loop, and not a Canvas FPS claim.
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

/** Honest metric names shown in the metrics dock. */
export const METRIC_LABELS = {
  displayRafRate: "Display rAF rate",
  wsRtt: "WebSocket RTT",
  inboundRate: "Inbound messages/s",
  outboundRate: "Outbound messages/s",
  participants: "Participants",
  sequenceHead: "Sequence head",
} as const;

export interface DiagnosticsSnapshot {
  displayRafRate: number | null;
  rttMs: number | null;
  inboundPerSec: number;
  outboundPerSec: number;
  participants: number;
  sequenceHead: number;
  expanded: boolean;
}

export class DiagnosticsPanel {
  private readonly root: HTMLDetailsElement;
  private readonly rafRateEl: HTMLElement;
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
  private displayRafRate: number | null = null;

  private lastFrameAt: number | null = null;
  private rafAccumMs = 0;
  private rafFrames = 0;
  private rafId: number | null = null;
  private rateTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sendPing: (() => void) | null = null;
  private running = false;

  constructor() {
    this.root = document.createElement("details");
    this.root.id = "debug-panel";
    this.root.className = "debug-panel";
    this.root.setAttribute("aria-label", "Room metrics");
    this.root.innerHTML = `
      <summary class="debug-summary">Metrics</summary>
      <dl class="debug-metrics">
        <div><dt>${METRIC_LABELS.displayRafRate}</dt><dd data-metric="raf">—</dd></div>
        <div><dt>${METRIC_LABELS.wsRtt}</dt><dd data-metric="rtt">—</dd></div>
        <div><dt>${METRIC_LABELS.inboundRate}</dt><dd data-metric="in">0</dd></div>
        <div><dt>${METRIC_LABELS.outboundRate}</dt><dd data-metric="out">0</dd></div>
        <div><dt>${METRIC_LABELS.participants}</dt><dd data-metric="presence">0</dd></div>
        <div><dt>${METRIC_LABELS.sequenceHead}</dt><dd data-metric="seq">0</dd></div>
      </dl>
      <p class="debug-note">Local measurements only. Display rAF rate is display cadence, not Canvas paint cost or an SLA.</p>
    `;

    const host =
      document.querySelector(".stage-wrap") ?? document.body;
    host.appendChild(this.root);

    this.rafRateEl = this.root.querySelector('[data-metric="raf"]')!;
    this.rttEl = this.root.querySelector('[data-metric="rtt"]')!;
    this.inEl = this.root.querySelector('[data-metric="in"]')!;
    this.outEl = this.root.querySelector('[data-metric="out"]')!;
    this.presenceEl = this.root.querySelector('[data-metric="presence"]')!;
    this.seqEl = this.root.querySelector('[data-metric="seq"]')!;

    this.root.addEventListener("toggle", () => {
      if (this.root.open && this.running) {
        this.scheduleRafSampler();
      } else {
        this.pauseRafSampler();
      }
      this.render();
    });
  }

  start(sendPing: () => void): void {
    this.sendPing = sendPing;
    this.running = true;
    this.clearIntervalTimers();
    this.pauseRafSampler();
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
    if (this.root.open) {
      this.scheduleRafSampler();
    }
    this.render();
  }

  stop(): void {
    this.running = false;
    this.clearIntervalTimers();
    this.pauseRafSampler();
    this.sendPing = null;
    this.lastFrameAt = null;
    this.displayRafRate = null;
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
      displayRafRate: this.displayRafRate,
      rttMs: this.rttMs,
      inboundPerSec: this.inboundPerSec,
      outboundPerSec: this.outboundPerSec,
      participants: this.participants,
      sequenceHead: this.sequenceHead,
      expanded: this.root.open,
    };
  }

  private scheduleRafSampler(): void {
    if (this.rafId !== null) {
      return;
    }
    const tick = (now: number): void => {
      this.rafId = null;
      if (!this.running || !this.root.open) {
        return;
      }
      if (this.lastFrameAt !== null) {
        const delta = now - this.lastFrameAt;
        this.rafAccumMs += delta;
        this.rafFrames += 1;
        if (this.rafAccumMs >= 500) {
          this.displayRafRate = (this.rafFrames * 1000) / this.rafAccumMs;
          this.rafAccumMs = 0;
          this.rafFrames = 0;
          this.render();
        }
      }
      this.lastFrameAt = now;
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pauseRafSampler(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameAt = null;
    this.rafAccumMs = 0;
    this.rafFrames = 0;
    this.displayRafRate = null;
  }

  private clearIntervalTimers(): void {
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
    this.rafRateEl.textContent =
      this.displayRafRate === null
        ? "—"
        : `${this.displayRafRate.toFixed(1)} Hz`;
    this.rttEl.textContent =
      this.rttMs === null ? "—" : `${this.rttMs.toFixed(1)} ms`;
    this.inEl.textContent = String(this.inboundPerSec);
    this.outEl.textContent = String(this.outboundPerSec);
    this.presenceEl.textContent = String(this.participants);
    this.seqEl.textContent = String(this.sequenceHead);
  }
}
