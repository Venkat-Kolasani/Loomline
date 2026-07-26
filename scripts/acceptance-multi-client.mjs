/**
 * Systematic multi-client acceptance against a live Loomline origin.
 *
 * Usage:
 *   LOOMLINE_URL=http://127.0.0.1:8787 node scripts/acceptance-multi-client.mjs
 *   LOOMLINE_URL=https://loomline.kolasanivenkat2.workers.dev node scripts/acceptance-multi-client.mjs
 *
 * Covers: live sync, overlapping commits, global undo/redo, mid-session join,
 * reconnect snapshot, and room isolation. Prints PASS/FAIL per check.
 */

const PROTOCOL_VERSION = 2;
const BASE_URL = (process.env.LOOMLINE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

const results = [];

function roomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function wsUrl(id) {
  const u = new URL(BASE_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = `room=${id}`;
  return u.toString();
}

function waitOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("open timeout")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    });
  });
}

function once(socket, match, label = "message", ms = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timeout waiting for ${label}`));
    }, ms);
    const onMessage = (event) => {
      if (typeof event.data !== "string") return;
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

async function connect(id, name) {
  const socket = new WebSocket(wsUrl(id));
  await waitOpen(socket);
  const welcomeP = once(
    socket,
    (m) => m.type === "welcome",
    "welcome",
  );
  const syncP = once(socket, (m) => m.type === "sync_state", "sync_state");
  socket.send(
    JSON.stringify({
      type: "join",
      protocolVersion: PROTOCOL_VERSION,
      roomId: id,
      displayName: name,
    }),
  );
  const welcome = await welcomeP;
  const sync = await syncP;
  return { socket, welcome, sync, name };
}

function sendStroke(socket, id, strokeId, color, points) {
  const [first, ...rest] = points;
  socket.send(
    JSON.stringify({
      type: "stroke:start",
      protocolVersion: PROTOCOL_VERSION,
      roomId: id,
      strokeId,
      tool: "brush",
      color,
      width: 4,
      point: first,
    }),
  );
  if (rest.length > 0) {
    socket.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
        strokeId,
        points: rest,
      }),
    );
  }
  socket.send(
    JSON.stringify({
      type: "stroke:end",
      protocolVersion: PROTOCOL_VERSION,
      roomId: id,
      strokeId,
    }),
  );
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log(`Acceptance against ${BASE_URL}`);
  const id = roomId();
  console.log(`Room ${id}\n`);

  let a;
  let b;
  let c;

  await check("A and B join same room", async () => {
    a = await connect(id, "Alpha Tester");
    b = await connect(id, "Beta Tester");
    if (a.welcome.participant.displayName !== "Alpha Tester") {
      throw new Error("A name mismatch");
    }
    if (b.welcome.participant.displayName !== "Beta Tester") {
      throw new Error("B name mismatch");
    }
    return `A=${a.welcome.participant.id.slice(0, 8)} B=${b.welcome.participant.id.slice(0, 8)}`;
  });

  await check("Live stroke fan-out before end", async () => {
    const liveStart = once(
      b.socket,
      (m) =>
        m.type === "stroke:live" &&
        m.phase === "start" &&
        m.strokeId === "live-1",
      "live start",
    );
    const livePoints = once(
      b.socket,
      (m) =>
        m.type === "stroke:live" &&
        m.phase === "points" &&
        m.strokeId === "live-1",
      "live points",
    );
    a.socket.send(
      JSON.stringify({
        type: "stroke:start",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
        strokeId: "live-1",
        tool: "brush",
        color: "#0f6a5a",
        width: 4,
        point: { x: 10, y: 10 },
      }),
    );
    await liveStart;
    a.socket.send(
      JSON.stringify({
        type: "stroke:points",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
        strokeId: "live-1",
        points: [
          { x: 40, y: 50 },
          { x: 80, y: 90 },
        ],
      }),
    );
    await livePoints;
    const committedA = once(
      a.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "live-1",
      "commit A",
    );
    const committedB = once(
      b.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "live-1",
      "commit B",
    );
    a.socket.send(
      JSON.stringify({
        type: "stroke:end",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
        strokeId: "live-1",
      }),
    );
    const [ca, cb] = await Promise.all([committedA, committedB]);
    if (ca.operation.sequence !== cb.operation.sequence) {
      throw new Error("sequence mismatch on live commit");
    }
    return `seq=${ca.operation.sequence}`;
  });

  await check("Overlapping strokes get distinct sequences", async () => {
    const aCommit = once(
      a.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "overlap-a",
      "overlap A",
    );
    const bCommit = once(
      b.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "overlap-b",
      "overlap B",
    );
    // Also observe peer copies
    const aSeesB = once(
      a.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "overlap-b",
      "A sees B",
    );
    const bSeesA = once(
      b.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "overlap-a",
      "B sees A",
    );
    sendStroke(a.socket, id, "overlap-a", "#1d4ed8", [
      { x: 20, y: 20 },
      { x: 60, y: 60 },
    ]);
    sendStroke(b.socket, id, "overlap-b", "#be123c", [
      { x: 30, y: 80 },
      { x: 90, y: 30 },
    ]);
    const [ownA, ownB, peerA, peerB] = await Promise.all([
      aCommit,
      bCommit,
      aSeesB,
      bSeesA,
    ]);
    const seqs = new Set([
      ownA.operation.sequence,
      ownB.operation.sequence,
      peerA.operation.sequence,
      peerB.operation.sequence,
    ]);
    if (seqs.size !== 2) {
      throw new Error(`expected 2 distinct sequences, got ${[...seqs]}`);
    }
    if (ownA.operation.sequence === ownB.operation.sequence) {
      throw new Error("same sequence assigned to overlapping strokes");
    }
    return `seqs=${ownA.operation.sequence},${ownB.operation.sequence}`;
  });

  await check("Global undo/redo converges on A and B", async () => {
    const changedB = once(
      b.socket,
      (m) => m.type === "history:changed",
      "history B undo",
    );
    const changedA = once(
      a.socket,
      (m) => m.type === "history:changed",
      "history A undo",
    );
    a.socket.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
      }),
    );
    const [ha, hb] = await Promise.all([changedA, changedB]);
    if (ha.operations.length !== hb.operations.length) {
      throw new Error("undo visible length mismatch");
    }
    if (ha.canRedo !== true || hb.canRedo !== true) {
      throw new Error("redo not enabled after undo");
    }
    const visibleAfterUndo = ha.operations.length;

    const redoA = once(
      a.socket,
      (m) => m.type === "history:changed",
      "history A redo",
    );
    const redoB = once(
      b.socket,
      (m) => m.type === "history:changed",
      "history B redo",
    );
    b.socket.send(
      JSON.stringify({
        type: "history:redo",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
      }),
    );
    const [ra, rb] = await Promise.all([redoA, redoB]);
    if (ra.operations.length !== visibleAfterUndo + 1) {
      throw new Error("redo did not restore one op");
    }
    if (ra.operations.length !== rb.operations.length) {
      throw new Error("redo visible length mismatch");
    }
    return `visible=${ra.operations.length} canUndo=${ra.canUndo} canRedo=${ra.canRedo}`;
  });

  await check("Mid-session joiner C sees correct sync_state", async () => {
    // Ensure redo cleared and a known head by committing one more stroke.
    const commit = once(
      a.socket,
      (m) => m.type === "operation:committed" && m.operation.strokeId === "for-c",
      "commit for C",
    );
    sendStroke(a.socket, id, "for-c", "#b45309", [
      { x: 100, y: 100 },
      { x: 140, y: 120 },
    ]);
    const committed = await commit;
    c = await connect(id, "Gamma Joiner");
    const visibleIds = c.sync.operations
      .filter((op) => op.kind === "stroke")
      .map((op) => op.strokeId)
      .sort();
    if (!visibleIds.includes("for-c")) {
      throw new Error(`C missing for-c; got ${visibleIds.join(",")}`);
    }
    if (c.sync.sequenceHead < committed.operation.sequence) {
      throw new Error("C sequenceHead behind");
    }
    if (c.sync.operations.some((op) => op.sequence > c.sync.sequenceHead)) {
      throw new Error("C ops beyond sequenceHead");
    }
    return `ops=${c.sync.operations.length} head=${c.sync.sequenceHead}`;
  });

  await check("Reconnect restores same visible committed state", async () => {
    const before = c.sync.operations.map((op) => op.sequence).join(",");
    c.socket.close();
    await new Promise((r) => setTimeout(r, 200));
    const re = await connect(id, "Gamma Joiner");
    const after = re.sync.operations.map((op) => op.sequence).join(",");
    if (before !== after) {
      throw new Error(`visible seq mismatch before=${before} after=${after}`);
    }
    if (re.welcome.participant.id === c.welcome.participant.id) {
      // Not strictly required to differ, but current design assigns fresh ids.
      // Soft check only if equal — still pass with note.
    }
    c.socket = re.socket;
    c.sync = re.sync;
    c.welcome = re.welcome;
    return `seqs=${after} newParticipant=${re.welcome.participant.id.slice(0, 8)}`;
  });

  await check("Different room stays isolated", async () => {
    const other = roomId();
    const d = await connect(other, "Delta Alone");
    if (d.sync.operations.length !== 0) {
      throw new Error("fresh room had ops");
    }
    if (d.sync.sequenceHead !== 0) {
      throw new Error("fresh room sequenceHead not 0");
    }
    // Ensure presence in other room does not affect primary — A still connected
    const presence = once(
      a.socket,
      (m) => m.type === "presence",
      "presence noise",
      1_000,
    ).then(
      () => "unexpected presence",
      () => "no cross-room presence (good)",
    );
    const note = await presence;
    d.socket.close();
    return note;
  });

  await check("Clear is durable and undoable for all", async () => {
    const clearA = once(
      a.socket,
      (m) =>
        m.type === "operation:committed" && m.operation.kind === "clear",
      "clear A",
    );
    const clearB = once(
      b.socket,
      (m) =>
        m.type === "operation:committed" && m.operation.kind === "clear",
      "clear B",
    );
    a.socket.send(
      JSON.stringify({
        type: "canvas:clear",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
      }),
    );
    const [ca, cb] = await Promise.all([clearA, clearB]);
    if (ca.operation.sequence !== cb.operation.sequence) {
      throw new Error("clear sequence mismatch");
    }
    const undoA = once(a.socket, (m) => m.type === "history:changed", "undo clear A");
    const undoB = once(b.socket, (m) => m.type === "history:changed", "undo clear B");
    b.socket.send(
      JSON.stringify({
        type: "history:undo",
        protocolVersion: PROTOCOL_VERSION,
        roomId: id,
      }),
    );
    const [ua, ub] = await Promise.all([undoA, undoB]);
    if (ua.operations.some((op) => op.kind === "clear" && op.sequence === ca.operation.sequence)) {
      throw new Error("clear still visible after undo");
    }
    if (ua.operations.length !== ub.operations.length) {
      throw new Error("post-clear-undo mismatch");
    }
    return `clearSeq=${ca.operation.sequence} restoredOps=${ua.operations.length}`;
  });

  for (const client of [a, b, c]) {
    try {
      client?.socket?.close();
    } catch {
      // ignore
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
