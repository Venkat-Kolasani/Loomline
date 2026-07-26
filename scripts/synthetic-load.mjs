/**
 * Reproducible synthetic load: 5 WebSocket clients × 100 completed strokes.
 *
 * Usage (with `npm run dev` already serving locally):
 *   node scripts/synthetic-load.mjs
 *   LOOMLINE_URL=http://127.0.0.1:8787 node scripts/synthetic-load.mjs
 *
 * Prints wall-clock duration, commit rate, observed sequence head, message
 * counts, and GET /api/room-metrics when available. Does not invent CPU %.
 */

const PROTOCOL_VERSION = 3;
const CLIENTS = 5;
const STROKES_PER_CLIENT = 100;
const BASE_URL = (process.env.LOOMLINE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

function roomIdFromSeed(seed) {
  // 8 lowercase hex chars
  let hex = "";
  for (let i = 0; i < 8; i += 1) {
    hex += ((seed + i * 17) % 16).toString(16);
  }
  return hex;
}

function wsUrl(roomId) {
  const u = new URL(BASE_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = `room=${roomId}`;
  return u.toString();
}

function waitOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket error"));
    });
  });
}

function onceMessage(socket, match) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("message timeout"));
    }, 30_000);
    const onMessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (match(message)) {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(message);
      }
    };
    socket.addEventListener("message", onMessage);
  });
}

async function runClient(roomId, clientIndex, stats) {
  const socket = new WebSocket(wsUrl(roomId));
  let inbound = 0;
  let outbound = 0;
  let ownCommits = 0;
  let maxSequence = 0;
  let errors = 0;
  const ownPrefix = `c${clientIndex}-`;

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    inbound += 1;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "operation:committed") {
      maxSequence = Math.max(maxSequence, message.operation.sequence);
      if (String(message.operation.strokeId).startsWith(ownPrefix)) {
        ownCommits += 1;
      }
    }
    if (message.type === "error") {
      errors += 1;
    }
  });

  const send = (payload) => {
    outbound += 1;
    socket.send(JSON.stringify(payload));
  };

  await waitOpen(socket);
  const welcome = onceMessage(socket, (m) => m.type === "welcome");
  const sync = onceMessage(socket, (m) => m.type === "sync_state");
  send({
    type: "join",
    protocolVersion: PROTOCOL_VERSION,
    roomId,
    displayName: `Load-${clientIndex}`,
  });
  await welcome;
  await sync;

  // Stagger starts slightly so the DO interleaves clients.
  await new Promise((r) => setTimeout(r, clientIndex * 15));

  // Stay under MAX_MESSAGES_PER_WINDOW (120/s): ~3 frames/stroke → ≥25ms gap.
  for (let s = 0; s < STROKES_PER_CLIENT; s += 1) {
    const strokeId = `${ownPrefix}s${s}`;
    const color = `#${((clientIndex * 40 + s) % 200 + 20).toString(16).padStart(2, "0")}6a5a`;
    // Normalized coordinates (fractions of a canvas box), kept inside 0–1.
    const x0 = (0.01 + clientIndex * 0.02 + (s % 50) * 0.001) % 1;
    const y0 = (0.01 + s * 0.001) % 1;
    send({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
      tool: "brush",
      color,
      width: 4,
      point: { x: x0, y: y0 },
    });
    send({
      type: "stroke:points",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
      points: [
        { x: x0 + 0.002, y: y0 + 0.002 },
        { x: x0 + 0.004, y: y0 + 0.001 },
      ],
    });
    send({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId,
      strokeId,
    });
    await new Promise((r) => setTimeout(r, 30));
  }

  const expected = STROKES_PER_CLIENT;
  const deadline = Date.now() + 120_000;
  while (ownCommits < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  socket.close(1000, "load-done");
  stats.push({
    clientIndex,
    inbound,
    outbound,
    ownCommits,
    maxSequence,
    errors,
    complete: ownCommits >= expected,
  });
}

async function fetchRoomMetrics(roomId) {
  try {
    const response = await fetch(
      `${BASE_URL}/api/room-metrics?room=${encodeURIComponent(roomId)}`,
    );
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true, body: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const roomId = roomIdFromSeed(Date.now() % 0xffff);
  console.log(
    JSON.stringify(
      {
        event: "load_start",
        baseUrl: BASE_URL,
        roomId,
        clients: CLIENTS,
        strokesPerClient: STROKES_PER_CLIENT,
        expectedOps: CLIENTS * STROKES_PER_CLIENT,
        node: process.version,
        platform: process.platform,
      },
      null,
      2,
    ),
  );

  const stats = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) => runClient(roomId, i, stats)),
  );
  const elapsedMs = performance.now() - started;
  const metrics = await fetchRoomMetrics(roomId);

  const totalCommits = stats.reduce((n, s) => n + s.ownCommits, 0);
  const totalIn = stats.reduce((n, s) => n + s.inbound, 0);
  const totalOut = stats.reduce((n, s) => n + s.outbound, 0);
  const maxSeq = Math.max(0, ...stats.map((s) => s.maxSequence));
  const allComplete = stats.every((s) => s.complete);

  const report = {
    event: "load_complete",
    roomId,
    elapsedMs: Math.round(elapsedMs),
    commitsPerSec: Number((totalCommits / (elapsedMs / 1000)).toFixed(2)),
    totalCommits,
    expectedOps: CLIENTS * STROKES_PER_CLIENT,
    allComplete,
    observedMaxSequence: maxSeq,
    totalInboundMessages: totalIn,
    totalOutboundMessages: totalOut,
    perClient: stats,
    roomMetrics: metrics,
    limitations: [
      "No Worker/DO CPU% is exposed by the runtime; not reported.",
      "Clients are Node WebSockets, not browser Canvas paint load.",
      "Wall clock includes join + commit fan-out wait.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  if (!allComplete || totalCommits < CLIENTS * STROKES_PER_CLIENT) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
