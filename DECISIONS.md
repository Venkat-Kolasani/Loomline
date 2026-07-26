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

- Production Worker serves assets + health at
  <https://loomline.kolasanivenkat2.workers.dev>; the `ROOM` binding and v1
  SQLite migration deployed successfully.
- Automated tests prove room isolation, sequencing, history, boundary recovery,
  and hibernation-safe expiry. The deployed smoke proves two-client live fan-out,
  isolation, global undo/redo, and reconnect snapshot recovery. See
  [TESTING.md](./TESTING.md).

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

- Reject oversized text frames (`MAX_CLIENT_MESSAGE_BYTES = 16_384` **UTF-8
  bytes** via `TextEncoder`) before parse.
- Keep shape validation in `parseClientMessage` (unknown type, version, points).
- Per-participant fixed window: `120` messages / `1s` → typed `rate_limited`,
  applied to **every** frame once the socket has a participant id (before parse).
- Process every accepted history request under DO serialization — **no debounce**.
- On last participant leave: clear live map, expiry rows, rate counters, and
  `deleteAlarm`. Retain committed SQLite ops.
- Document room growth honestly: the measured local baseline is 500 operations,
  not a hard cap or production capacity claim. Future checkpoint / retention
  follows replay-size measurements, not an arbitrary reset.

### Rejected alternative

**Debounce / coalesce undo-redo** so “spam” history collapses to one action.

Rejected because intentional rapid undo must apply; silently dropping actions
would diverge clients and violate explainable global history.

**Wipe the operation log when the room empties or after N ops.**

Rejected as premature: empties happen often in demos; wiping surprises rejoins
and has no measured threshold. Prefer a future checkpoint record once Prompt 10
(or a load pass) measures rebuild cost.

### Verification

`test/boundaries.test.ts` (malformed JSON, unknown type, oversized ASCII +
Unicode UTF-8 bypass, rate limit on valid / malformed / repeated-join frames,
rapid history, zero-user cleanup). Prior `test/history.test.ts` rapid path.
Gate recorded in [TESTING.md](./TESTING.md).

## D8 — Measured diagnostics only (`?debug=1` + synthetic load)

### Problem / invariant

Interviewers ask for FPS / latency / scale evidence. Claiming “60 FPS” or a
fixed RTT budget without a stated workload violates the evidence rule.

### Selected design

- Optional collapsed **Metrics** dock when `?debug=1` is present: Display rAF
  rate from rAF deltas (only while expanded), WebSocket RTT from `ping`/`pong`,
  inbound/outbound messages/s, presence count, sequence head.
- Reproducible `scripts/synthetic-load.mjs`: 5 clients × 100 strokes; record
  wall clock, commit rate, `/api/room-metrics` head — never invent CPU%.
- Document browser/machine/network and limitations next to the numbers.
- Never label display cadence as “Canvas FPS.”

### Rejected alternative

**Always-on HUD and marketing “60 FPS / &lt;50 ms” badges.**

Rejected: permanent UI noise for reviewers; unmeasured SLA claims are dishonest.
A always-expanded corner panel was also rejected for the polish pass — the dock
stays collapsed until a developer opens it.

### Verification

`test/observability.test.ts` (label honesty + ping/pong + room-metrics). Manual
panel use + `npm run load` results in [TESTING.md](./TESTING.md).

## D9 — One-origin Cloudflare deployment without repository credentials

### Problem / invariant

The submission needs a reliable public demo while preserving the same-origin
WebSocket path and Durable Object routing tested locally. Cloudflare account
credentials must never enter source control.

### Selected design

Deploy one Worker named `loomline` with:

- Vite output in `dist/client` served through the `ASSETS` binding;
- `/ws` and `/api/*` handled by the Worker;
- one `ROOM` Durable Object binding with the v1 SQLite class migration;
- `workers_dev = true`, producing
  <https://loomline.kolasanivenkat2.workers.dev>.

Wrangler OAuth state remains in the developer's local Cloudflare configuration.
No API token, account id, `.dev.vars`, or `.env` value is required by the app or
committed to the repository.

### Rejected alternative

Split the static client onto a second host and point it at a separately deployed
WebSocket origin. Rejected because it adds CORS/origin configuration and another
failure boundary without helping the room consistency model. A temporary
preview deployment was also rejected because the submission needs a stable URL.

### Verification

- `wrangler deploy --dry-run` resolved `ROOM` and `ASSETS`.
- Production deployment version
  `a1fc2216-2c09-4bf7-b6b9-d9cf4f431c76` completed successfully.
- `/` and `/api/health` returned HTTP 200.
- Fresh production clients proved mid-stroke fan-out, isolated rooms, matching
  global undo/redo state, and reconnect `sync_state`. Exact evidence is in
  [TESTING.md](./TESTING.md).

## D10 — Clear is a sequenced replay barrier

### Problem / invariant

The original Clear button only erased one browser's pixels; peers and reconnect
still showed the durable strokes. Global Clear must converge, survive reconnect,
participate in undo/redo, and preserve an active stroke that completes afterward.

### Selected design

`canvas:clear` asks the room Durable Object to append a discriminated
`kind: "clear"` operation with the next sequence. During deterministic replay a
visible clear resets prior pixels; later strokes paint normally. Tombstoning the
clear restores prior strokes, and redo makes the barrier visible again. Active
strokes remain ephemeral during clear and receive a later sequence if completed.
Protocol v2 adds `kind: "stroke" | "clear"` to the committed operation model.

SQLite remains append-only. An `operation_type` column is added in place;
existing rows default to `stroke`, while clear rows use the same authoritative
sequence and history tables.

### Rejected alternatives

- **Delete operation rows:** destroys undo/reconnect history and breaks the
  append-only invariant.
- **Broadcast a temporary clear event:** disappears after reconnect and cannot
  participate correctly in global undo/redo.
- **Cancel active strokes:** silently loses valid user work and makes ordering
  depend on client timing rather than the server sequence.

### Verification

`test/clear-history.test.ts` covers two-client fan-out, join/reconnect
persistence, undo/redo convergence, a stroke completing after clear, and
recoverable malformed clear input. `test/committed-ops.test.ts` verifies replay
order `stroke → clear → stroke`.

## D11 — Browser-local artist name, not an account or sticky identity

### Problem / invariant

The old server fallback (`Artist-<id>`) was safe but unfriendly in a live demo.
Invitees opening a room link need a clear way to choose a readable name before
they appear in presence. This must not create authentication, a server profile,
or a client-controlled participant identity.

### Selected design

The landing page offers a 1–24-character name with a readable random fallback.
The normalized value is stored only in browser `localStorage` and passed through
the existing optional `join.displayName` field. A first-time `/r/<roomId>` visit
stays on the landing page until the user joins; a returning browser can rejoin
with its saved name. The Durable Object still trims/caps the wire value and
assigns a fresh participant id and deterministic colour on every join.

### Rejected alternatives

- **Keep opaque generated names only:** requires no UI but makes people and
  cursor labels harder to follow in a collaboration demo.
- **Persist a server-side profile or auth account:** exceeds assignment scope
  and does not improve authoritative canvas ordering.
- **Live rename / client-provided participant id:** adds a new presence protocol
  and gives clients authority that belongs to the room server.

### Verification

`test/artist-name.test.ts` covers validation, readable fallback, persistence,
and unavailable storage. `test/rooms.test.ts` proves the Worker trims/caps a
supplied name and falls back for blank input. Local browser proof is recorded in
[TESTING.md](./TESTING.md).

## D12 — Progressive invite sharing with an explicit manual fallback

### Problem / invariant

A raw URL in the room header is easy to miss and awkward on mobile. Inviting
must always resolve to the canonical `/r/<roomId>` path without leaking local
debug query state or changing room membership/history.

### Selected design

The header uses a **Share link** control. It calls the native device share sheet
when present; otherwise it writes the canonical URL to the clipboard. If both
APIs are unavailable or denied, the readonly input receives selection and the
UI explains how to copy it manually. A user-cancelled native share leaves the
clipboard untouched.

### Rejected alternatives

- **Raw anchor only:** works, but is less discoverable and provides no feedback.
- **External sharing SDK:** unnecessary dependency and account surface for one
  URL.
- **Always copy after a cancelled share:** surprising side effect that overwrites
  a user's clipboard after they explicitly backed out.

### Verification

`test/invite.test.ts` covers canonical URL creation, native share, clipboard
fallback, cancellation, and manual fallback. Current automated/local-server
evidence is recorded in [TESTING.md](./TESTING.md).

## D13 — Canvas-first responsive grid over a fixed-height canvas

### Problem / invariant

On a narrow viewport, wrapped controls and browser chrome could leave the
current fixed-minimum stage visually cramped. Mobile drawing must remain a
Pointer Events canvas with its full visible CSS box reflected in DPR sizing.

### Selected design

At `≤640px`, use a safe-area-aware `100dvh` CSS grid. The canvas sits before a
single horizontal-scroll toolbar, receives the remaining row height, and keeps a
bounded dynamic-viewport minimum. Presence becomes a compact horizontal strip;
interactive tool controls are at least 44 CSS pixels high. Desktop layout and
the Canvas/ResizeObserver implementation remain unchanged.

### Rejected alternatives

- **`100vh` with a fixed canvas height:** mobile browser chrome can make it
  overflow or waste available space.
- **Hide controls on mobile:** improves space at the cost of discoverability and
  keyboard/accessibility parity.
- **Change pointer coordinates for mobile:** unnecessary and risks breaking the
  existing CSS-pixel/DPR invariant.

### Verification

Production build accepts the CSS and existing canvas sizing/pointer tests stay
green. A physical mobile and browser-viewport drawing pass remains required and
is explicitly not claimed in [TESTING.md](./TESTING.md).

## D14 — Derive active collaborator labels from live stroke batches

### Problem / invariant

People need an unambiguous indication of who is drawing at a particular stroke
tip. Sending a parallel cursor message during pointer drawing would compete with
the rAF-batched live-stroke stream and consume room rate-limit budget without
improving the cursor's underlying coordinates.

### Selected design

For `stroke:live` start/points/end frames, the client uses the latest existing
point as that participant's DOM cursor position and marks the cue active until
the end frame. Idle pointer movement continues to use the existing cursor
message. The label stays outside the two Canvas buffers, flips before a stage
edge, honours reduced-motion preference, and is removed through existing
presence/reconnect cleanup.

### Rejected alternatives

- **Send cursor frames alongside every drawing batch:** redundant network and
  limiter pressure for the same position data.
- **Paint names into the live canvas:** would blur semantic UI with ephemeral
  drawing pixels and make accessibility/edge placement harder.

### Verification

`test/remote-cursors.test.ts` verifies latest-point selection and edge placement;
the full typecheck/test/build gate is recorded in [TESTING.md](./TESTING.md).
Fresh interactive browser proof remains explicitly pending while the embedded
browser's local-navigation policy is active.

## D15 — Separate brush and partial-eraser controls without new history modes

### Problem / invariant

Artists need brush colour/width and a labelled partial eraser with its own size,
plus accidental-clear protection, without changing the durable operation model
or inventing a third eraser mode that would complicate global undo.

### Selected design

Client-only `ToolSettings` retains brush and eraser widths independently (1–32px,
same clamp as the renderer). The toolbar shows contextual width label + presets,
keeps colour disabled for eraser, and uses the existing circular eraser cursor.
Clear requires an explicit “Clear for everyone?” confirmation because clear is
room-global and durable. Keyboard shortcuts (`B`/`E`, modifier undo/redo) are
ignored while focus is in an editable control.

### Rejected alternatives

- **One shared width for brush and eraser:** forces awkward size changes when
  switching tools and hides the Notability-style partial-eraser affordance.
- **Whole-stroke eraser / object deletion:** would require targeting completed
  ops and new conflict rules; deferred past submission.
- **Immediate Clear without confirmation:** too easy to wipe a collaborative
  room mid-demo.

### Verification

`test/tool-settings.test.ts` covers independent widths and clamping; the full
gate is recorded in [TESTING.md](./TESTING.md).

## D16 — Collapsed metrics dock with honest Display rAF naming

### Problem / invariant

Developer metrics must remain available for interviews without dominating the
canvas or implying an unmeasured “Canvas FPS” SLA.

### Selected design

Keep `?debug=1` only. Mount a canvas-corner `<details>` labelled **Metrics**,
collapsed by default. Expanded labels are Display rAF rate, WebSocket RTT,
inbound/outbound messages/s, participants, and sequence head. The rAF sampler
runs only while the disclosure is open so a closed dock does not keep a
permanent measurement loop.

### Rejected alternatives

- **Always-expanded fixed HUD:** steals attention from the drawing surface.
- **Calling the metric “FPS” / “Canvas FPS”:** conflates display refresh cadence
  with Canvas paint cost and invites false performance claims.

### Verification

`test/observability.test.ts` asserts label honesty; full gate in
[TESTING.md](./TESTING.md).
