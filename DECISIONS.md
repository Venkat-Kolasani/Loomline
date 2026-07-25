# Decisions

Each entry records the problem, selected design, rejected alternative, and how
it was (or will be) verified.

## D1 — Cloudflare Workers + Durable Objects instead of Node.js + `ws`

### Problem / invariant

The assignment brief says `Node.js + WebSockets`. We need a deployable,
interview-defensible realtime coordinator where each room has a single
authoritative sequence and shared undo/redo history. A sleeping free-tier
container would make multi-user demos unreliable.

### Selected design

Use **Cloudflare Workers** (edge JavaScript runtime) with **one Durable Object
per room** and Durable Object **SQLite** for committed operations. Clients still
use the **native browser WebSocket API**. Static assets and `wss` share one
origin via Workers static assets.

This is **not** Node.js. We will never describe Workers as Node to reviewers.

### Rejected alternative

A traditional Node HTTP + `ws` (or Socket.io) server on a VM/PaaS container.

Rejected for this submission because:

1. Free/hobby containers often sleep; cold starts break live multi-user demos.
2. Sticky room affinity and authoritative sequencing need extra design (Redis,
   single process, etc.).
3. A Durable Object is already a natural single-threaded coordinator per room id.

Socket.io was also rejected to keep the protocol explicit and interviewable.

### Verification

- Scaffold: Worker serves assets + health; DO class/binding/migration present
  (`npm run test`, `npm run dev`). See [TESTING.md](./TESTING.md).
- Later slices must prove room isolation, sequencing, hibernation reload, and
  reconnect without claiming Node compatibility.

## D2 — Scaffold now; Canvas/WebSocket later

### Problem / invariant

Build order in `PROJECT_BLUEPRINT.md` forbids starting stretch or product
features before the deployment skeleton works.

### Selected design

This commit only adds tooling, static asset serving, DO skeleton, scripts, and
docs with clear planned-vs-implemented labels.

### Rejected alternative

Generating Canvas, rooms, and protocol stubs in the first commit.

Rejected because it would mix unverified behavior into the baseline and weaken
the reviewability of each slice.

### Verification

No Canvas/WebSocket/room routing code exists in this slice; tests cover health
and DO skeleton only.

## Deferred decisions (planned)

These will get full decision records when implemented:

- Global tombstone undo/redo vs mutating/deleting ops
- Overlap policy = server sequence stacking (not pixel merge / CRDT)
- Snapshot vs full replay for reconnect of large histories

## D3 — rAF point batching for live stroke network sends

### Problem / invariant

Raw pointer events can fire far more often than one frame. Emitting one
WebSocket message per sample would flood the room and fight the “local paint
before network” invariant by coupling responsiveness to send rate.

### Selected design

- Local canvas updates on every accepted filtered point immediately.
- `StrokePointBatcher` queues outbound points and flushes **at most once per
  `requestAnimationFrame`** as `stroke:points`.
- `stroke:start` and `stroke:end` send immediately (end flushes the batcher
  first). The Durable Object fans out `stroke:live` to peers only — no SQLite.

### Rejected alternative

One network message per pointer event, or a fixed timer (e.g. 50 ms) independent
of frames.

Rejected because per-event floods the wire under fast input, and a fixed timer
decouples from display refresh without improving local latency.

### Verification

- Unit: `test/stroke-batcher.test.ts` coalesces multiple enqueues into one flush.
- Integration: `test/live-strokes.test.ts` proves peer receives `stroke:live`
  start/points before end.
- Manual two-browser: peer sees ink mid-stroke. See [TESTING.md](./TESTING.md).

## D4 — Durable ops are append-only sequenced strokes, not per-point rows

### Problem / invariant

Completed strokes must converge for every client. Live points are high-volume
and ephemeral; persisting each point would explode storage and break hibernation
assumptions.

### Selected design

On `stroke:end`, the room DO assigns `sequence = MAX+1`, inserts **one** SQLite
row with the full point list, and broadcasts `operation:committed` to all
sockets. Join sends `sync_state` with the ordered log. Clients rebuild
committed-canvas only from that log.

### Rejected alternative

CRDT / client-assigned order, or one DB row per pointer sample.

Rejected because a single DO coordinator already gives a total order, and
per-point rows violate the blueprint storage rule.

### Verification

`test/history.test.ts` (sequence equality, join snapshot, abandon, brush/eraser
overlap). See [TESTING.md](./TESTING.md).
