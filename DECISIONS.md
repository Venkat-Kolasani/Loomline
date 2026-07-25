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

- Sticky participant identity across reconnect
- Checkpoint / retention for very large operation logs

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

## D5 — Global tombstone undo/redo (not per-user, not mutating the log)

### Problem / invariant

Completed strokes must be undoable across participants without forking the room
or rewriting history. Live strokes must not be undoable. A new draw after undo
must clear redo (classic linear history branch).

### Selected design

- **Global** undo/redo: any joined client may tombstone the latest **visible**
  completed op; peers all rebuild from `history:changed`.
- Tombstones live in SQLite (`history_hidden` + `history_redo_stack`). The
  `operations` table stays append-only.
- New `operation:committed` clears the redo stack only; prior hidden sequences
  stay hidden.

### Rejected alternative

**Per-user undo stacks** (each participant only undoes their own strokes).

Rejected because the assignment asks for global undo (User A undoes User B) and
per-user stacks diverge room state under concurrent history edits. Mutating or
deleting operation rows was also rejected: it breaks auditability and join
replay of the true log head.

### Verification

`test/history.test.ts` undo-peer / redo / redo-invalidation / rapid history /
two-client convergence. Manual two-browser proof in [TESTING.md](./TESTING.md).

## D6 — Full snapshot reconnect (not last-seq delta) + 30s live stall expiry

### Problem / invariant

A dropped client must restore the same committed canvas, never double-apply a
sequence, and must not persist provisional pointer points. Hibernation must not
assume in-memory live strokes survive.

### Selected design

- Client: exponential reconnect with jitter; UI Connecting / Reconnecting /
  Connected; on schedule, clear ephemeral ink; on join, replace committed store
  from full visible `sync_state`.
- Client: `appliedSequences` set suppresses duplicate `operation:committed`.
- Server: DO constructor re-ensures SQLite schemas; live **points** map starts
  empty after hibernation. Idle strokes expire after 30s via alarm using durable
  `live_stroke_expiry` metadata (ids + `expires_at` only — never points).

### Rejected alternative

**Delta sync by `lastSequence` only** (send ops with sequence > N).

Rejected for this slice because undo tombstones change **visibility** without
changing sequence head — a pure delta can revive hidden ops or miss visibility
flips. Full visible snapshot is simpler and correct; delta remains a future
optimization once a versioned visibility token exists.

**In-memory-only stall expiry** (no SQLite metadata).

Rejected after review: hibernatable WebSockets stay connected while the DO is
evicted, wiping `liveStrokes`; an alarm wake with an empty map would leave peer
overlays stuck forever. Minimal expiry rows fix that without persisting points.

### Trade-off (not optimized yet)

Upserting `live_stroke_expiry.expires_at` on every accepted `stroke:points`
batch (≤ one rAF flush per active drawer) can mean roughly **one small SQLite
write per frame per drawer** while a stroke is in progress. That is intentional
correctness-first behavior so hibernation cannot leave peer overlays stuck.

Do **not** coalesce/throttle these writes in this submission unless load testing
shows real pressure. If it does, measure write rate under a stated drawer count /
stroke length, then consider a cheaper refresh (e.g. update expiry only every
N ms or only when the alarm would move) — never by dropping the durable row.

### Verification

`test/reconnect.test.ts`, `test/reconnect-backoff.test.ts`,
`test/live-expiry-hibernate.test.ts` (`evictDurableObject` + `runDurableObjectAlarm`),
duplicate suppression in the committed store. Manual refresh reconnect in
[TESTING.md](./TESTING.md).

## D7 — Input boundaries without silent drops or premature log reset

### Problem / invariant

Malformed / abusive client frames must not crash a room (invariant 10). Normal
rAF-batched drawing must keep working. Rapid undo/redo must not corrupt sequence
or redo state. Empty rooms must be hibernation-eligible. Do not invent an
unmeasured operation-log wipe.

### Selected design

- Reject oversized text frames (`MAX_CLIENT_MESSAGE_BYTES = 16_384`) before parse.
- Keep shape validation in `parseClientMessage` (unknown type, version, points).
- Per-participant fixed window: `120` messages / `1s` → typed `rate_limited`.
- Process every accepted history request under DO serialization — **no debounce**.
- On last participant leave: clear live map, expiry rows, rate counters, and
  `deleteAlarm`. Retain committed SQLite ops.
- Document room growth honestly: **no measured hard cap yet**; future checkpoint /
  retention after load baseline (not an arbitrary reset in this slice).

### Rejected alternative

**Debounce / coalesce undo-redo** so “spam” history collapses to one action.

Rejected because intentional rapid undo must apply; silently dropping actions
would diverge clients and violate explainable global history.

**Wipe the operation log when the room empties or after N ops.**

Rejected as premature: empties happen often in demos; wiping surprises rejoins
and has no measured threshold. Prefer a future checkpoint record once Prompt 10
(or a load pass) measures rebuild cost.

### Verification

`test/boundaries.test.ts` (malformed JSON, unknown type, oversized, rate limit,
rapid history, zero-user cleanup). Prior `test/history.test.ts` rapid path.
Gate recorded in [TESTING.md](./TESTING.md).
