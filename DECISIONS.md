# Decisions

Each entry records the problem, selected design, rejected alternative(s), and
how the behavior was verified. Claims below match the current codebase unless
marked **historical**.

## D1 — Cloudflare Workers + Durable Objects instead of Node.js + `ws`

**Problem.** The brief says `Node.js + WebSockets`. The product needs a
deployable, interview-defensible realtime coordinator where each room has a
single authoritative sequence and shared undo/redo. Sleeping free-tier
containers make multi-user demos unreliable.

**Selected.** Cloudflare Workers (edge JavaScript runtime) with **one Durable
Object per room** and Durable Object SQLite for committed operations. Clients
still use the **native browser WebSocket API**. Static assets and `wss` share
one origin. This is **not** Node.js and must never be described as Node to
reviewers.

**Rejected.** A traditional Node HTTP + `ws` (or Socket.io) server on a
VM/PaaS container — cold starts break demos; sticky room affinity and
authoritative sequencing need extra infrastructure. Socket.io was also rejected
to keep the protocol explicit.

**Verified.** Production Worker at
<https://loomline.kolasanivenkat2.workers.dev>; automated isolation / sequencing
/ history / boundary / expiry tests; deployed two-client smoke in
[TESTING.md](./TESTING.md).

## D2 — Scaffold before product features (historical build-order)

**Problem.** `PROJECT_BLUEPRINT.md` forbids starting stretch or product features
before the deployment skeleton works.

**Selected (at the time).** First implementation commit only added tooling,
static asset serving, DO skeleton, scripts, and docs with planned-vs-implemented
labels.

**Rejected.** Generating Canvas, rooms, and protocol stubs in the first commit —
would mix unverified behavior into the baseline.

**Verified then.** Health + DO skeleton tests only. **Current code** has since
grown through the full must-ship path; D2 remains as the build-order decision,
not a description of today's feature set.

## D3 — rAF point batching for live stroke network sends

**Problem.** Raw pointer events fire faster than display refresh. One WebSocket
message per sample would flood the room and couple responsiveness to send rate.

**Selected.** Local canvas updates on every accepted filtered point immediately.
`StrokePointBatcher` flushes outbound points **at most once per
`requestAnimationFrame`** as `stroke:points`. `stroke:start` / `stroke:end` send
immediately (end flushes the batcher first). The DO fans out `stroke:live` to
peers only — no SQLite for live points.

**Rejected.** One network message per pointer event, or a fixed timer independent
of frames.

**Verified.** `test/stroke-batcher.test.ts`, `test/live-strokes.test.ts`, manual
two-browser mid-stroke proof in [TESTING.md](./TESTING.md).

## D4 — Durable ops are append-only sequenced records, not per-point rows

**Problem.** Completed strokes must converge for every client. Live points are
high-volume and ephemeral.

**Selected.** On `stroke:end`, the room DO assigns `sequence = MAX+1`, inserts
**one** SQLite row with the full point list (or a `clear` row for
`canvas:clear`), and broadcasts `operation:committed` to all sockets. Join sends
`sync_state` with the ordered **visible** log.

**Rejected.** CRDT / client-assigned order, or one DB row per pointer sample.

**Verified.** `test/history.test.ts`, `test/clear-history.test.ts`,
`test/committed-ops.test.ts`.

## D5 — Global tombstone undo/redo (not per-user, not mutating the log)

**Problem.** Completed strokes must be undoable across participants without
forking the room or rewriting history. Live strokes must not be undoable. A new
draw after undo must clear redo.

**Selected.** Global undo/redo: any joined client may tombstone the latest
**visible** completed op; peers rebuild from `history:changed`. Tombstones live
in `history_hidden` + `history_redo_stack`. The `operations` table stays
append-only. New commits clear the redo stack only; prior hidden sequences stay
hidden.

**Rejected.** Per-user undo stacks (assignment asks for global undo; concurrent
history edits diverge). Deleting or mutating operation rows (breaks auditability
and join replay).

**Verified.** `test/history.test.ts` (undo-peer, redo, redo-invalidation, rapid
history, two-client convergence); manual two-browser proof in
[TESTING.md](./TESTING.md).

## D6 — Full snapshot reconnect + hibernation-safe live stall expiry

**Problem.** A dropped client must restore the same committed canvas, never
double-apply a sequence, and must not persist provisional pointer points.
Hibernation must not assume in-memory live strokes survive.

**Selected.** Client: exponential reconnect with jitter (500 ms base, 15 s cap);
UI Connecting / Reconnecting / Connected; on join, replace committed store from
full visible `sync_state`; `appliedSequences` suppresses duplicate commits.
Server: constructor re-ensures schemas; live points map starts empty after
hibernation; idle strokes expire after 30 s via alarm using durable
`live_stroke_expiry` metadata (ids + `expires_at` only).

**Rejected.** Delta sync by `lastSequence` only (tombstones change visibility
without changing sequence head). In-memory-only stall expiry (hibernation wipe
would leave peer overlays stuck).

**Trade-off kept.** Upserting expiry on every accepted `stroke:points` batch can
mean roughly one small SQLite write per frame per active drawer. Correctness
first; coalesce only after measured pressure.

**Verified.** `test/reconnect.test.ts`, `test/reconnect-backoff.test.ts`,
`test/live-expiry-hibernate.test.ts` (`evictDurableObject` +
`runDurableObjectAlarm`).

## D7 — Input boundaries without silent drops or premature log reset

**Problem.** Malformed / abusive frames must not crash a room. Normal rAF drawing
must keep working. Rapid undo/redo must apply. Empty rooms must be
hibernation-eligible. Do not invent an unmeasured operation-log wipe.

**Selected.** Reject oversized text frames (`MAX_CLIENT_MESSAGE_BYTES = 16_384`
UTF-8 bytes) before parse; shape validation in `parseClientMessage`;
per-participant `120` abuse frames / `1s` for **invalid** traffic only
(binary / malformed / oversized / parse failures). **Valid protocol messages
are never rate-limited** so drawing, cursor, history, and Metrics `ping`
cannot starve `stroke:end` (extends I17).
Process every accepted history request under DO serialization (no debounce);
on last leave, clear live state / expiry / alarms but retain committed ops.

**Rejected.** Debouncing undo/redo (would silently drop intentional actions).
Rate-limiting valid strokes/cursors (demo clients hit false `rate_limited`
under Metrics pings or dense pointer traffic — I17). Wiping the op log when
empty or after arbitrary N (surprises rejoins; no measured threshold).

**Verified.** `test/boundaries.test.ts` (malformed JSON, unknown type, UTF-8
size bypass, abuse-only rate limit, valid-burst never limited, rapid history,
zero-user cleanup).

## D8 — Measured diagnostics only (honest labels, synthetic load)

**Problem.** Interviewers ask for FPS / latency / scale evidence. Unmeasured
“60 FPS / &lt;50 ms” claims violate the evidence rule.

**Selected.** Collapsed **Metrics** dock in every room: Display rAF rate **and**
RTT `ping`/`pong` only while expanded (I17), inbound/outbound messages/s,
participants, sequence head. Reproducible `scripts/synthetic-load.mjs`
(5×100 strokes; protocol v2). Never invent Worker CPU%. Never label display
cadence as “Canvas FPS.”

**Rejected.** Always-expanded marketing HUD. Hiding metrics behind `?debug=1`
only (reviewers need access without a secret flag).

**Verified.** `test/observability.test.ts`; `npm run load` results in
[TESTING.md](./TESTING.md) (500/500 commits in 3257 ms localhost).

## D9 — One-origin Cloudflare deployment without repository credentials

**Problem.** Submission needs a reliable public demo with same-origin WebSocket
routing. Credentials must never enter source control.

**Selected.** One Worker `loomline` with Vite output in `dist/client` via
`ASSETS`, `/ws` + `/api/*` on the Worker, `ROOM` Durable Object with v1 SQLite
migration, `workers_dev = true`. Git push does **not** auto-publish (Workers
Builds empty); use `npm run deploy` or optional Actions secrets.

**Rejected.** Split static host + separate WebSocket origin (CORS / dual failure
boundary). Assuming git auto-deploy without Builds or Actions.

**Verified.** Production redeploys and fresh-session smoke in
[TESTING.md](./TESTING.md).

## D10 — Clear is a sequenced replay barrier

**Problem.** A client-only Clear left peers and reconnects showing durable
strokes. Global Clear must converge, survive reconnect, participate in undo/redo,
and preserve an active stroke that completes afterward.

**Selected.** `canvas:clear` appends a `kind: "clear"` operation with the next
sequence. Replay resets prior pixels at that sequence; later strokes paint
normally. Tombstoning the clear restores prior strokes. Active strokes stay
ephemeral and receive a later sequence if completed. Protocol v2 discriminates
`stroke` | `clear`.

**Rejected.** Delete operation rows. Broadcast a temporary non-durable clear.
Cancel active strokes on clear.

**Verified.** `test/clear-history.test.ts`, `test/committed-ops.test.ts`.

## D11 — Browser-local artist name, not an account or sticky identity

**Problem.** Opaque `Artist-<id>` names are hard to follow in a live demo.
Invitees need a readable name without auth or client-controlled identity.

**Selected.** Landing offers an empty 1–24-character field (`autocomplete="off"`)
plus **Random name**. Field is never prefilled. After validation on join, the
name may be saved to `localStorage`, but every visit still requires explicit
entry. The Durable Object trims/caps the wire value and assigns a fresh
participant id and deterministic colour on every join.

**Rejected.** Opaque generated names only. Prefilling a random nickname on load.
Server-side profiles / auth. Live rename or client-provided participant ids.

**Verified.** `test/artist-name.test.ts`, `test/rooms.test.ts`; client always
sets the input to `""` on load.

## D12 — Progressive invite sharing with manual fallback

**Problem.** A raw URL in the header is easy to miss on mobile. Invites must
always resolve to canonical `/r/<roomId>` without leaking debug query state.

**Selected.** Copy-link icon + **Share link**: native share sheet when present,
else clipboard, else select the readonly input and explain manual copy.
User-cancelled native share does not overwrite the clipboard.

**Rejected.** Raw anchor only. External sharing SDK. Always copy after a
cancelled share.

**Verified.** `test/invite.test.ts`.

## D13 — Canvas-first responsive grid over a fixed-height canvas

**Problem.** On narrow viewports, wrapped controls and browser chrome cramped the
drawing surface. Mobile must remain Pointer Events with CSS-box-accurate DPR
sizing.

**Selected.** At `≤640px`, safe-area-aware `100dvh` CSS grid: header → compact
presence → canvas → horizontal-scroll toolbar. Desktop layout and ResizeObserver
sizing unchanged.

**Rejected.** Fixed `100vh` canvas height. Hiding controls on mobile. Changing
pointer coordinate math for mobile.

**Verified.** Production CSS + canvas sizing tests; deployed 390px layout proof
and author-confirmed physical phone two-user session on 26 July 2026
([TESTING.md](./TESTING.md)).

## D14 — Derive active collaborator labels from live stroke batches

**Problem.** Reviewers need to see who is drawing at a stroke tip. A parallel
cursor stream during drawing would compete with rAF stroke batches for the rate
limit.

**Selected.** For `stroke:live` start/points/end, use the latest existing point
as that participant's DOM cursor position and mark the cue active until end.
Idle movement still uses `cursor`. Labels stay outside the canvas buffers, flip
before edges, honour reduced-motion, and clear via presence/reconnect cleanup.

**Rejected.** Cursor frames alongside every drawing batch. Painting names into
the live canvas.

**Verified.** `test/remote-cursors.test.ts`; production two-client mid-stroke
label behavior recorded in [TESTING.md](./TESTING.md).

## D15 — Separate brush and eraser controls without new history modes

**Problem.** Artists need colour/width and a labelled punch-through eraser with
its own size, plus accidental-clear protection, without inventing a third eraser
history mode.

**Selected.** Client-only `ToolSettings` retains brush and eraser widths
independently (1–32px). Toolbar shows contextual width label + range slider,
disables colour for eraser, uses circular eraser cursor. Clear requires
“Clear for everyone?” confirmation. Shortcuts ignored while focus is editable.

**Rejected.** One shared width for both tools. Width preset chip row clutter.
Whole-stroke / object-deletion eraser (new conflict rules). Immediate Clear
without confirmation.

**Verified.** `test/tool-settings.test.ts`; current HTML labels **Eraser** (not
a separate history mode).

## D16 — Collapsed metrics dock with honest Display rAF naming

**Problem.** Developer metrics must stay available for interviews without
dominating the canvas or implying an unmeasured Canvas FPS SLA.

**Selected.** Canvas-corner `<details>` labelled **Metrics**, collapsed by
default, on every room session (no `?debug=1` gate). Expanded labels: Display
rAF rate, WebSocket RTT, messages/s, participants, sequence head. Sampler runs
only while open.

**Rejected.** Always-expanded HUD. `?debug=1` only. Calling the metric “FPS” /
“Canvas FPS.”

**Verified.** `test/observability.test.ts`; live demo Metrics control confirmed
26 July 2026.

## D17 — Punch-through eraser + provisional retain on short commits

**Problem.** Painting eraser as gray ink on the live layer looked like a brush
and failed to remove ink. Dropped live point batches could also make a shorter
committed eraser reopen previously erased ink.

**Selected.** Eraser uses Canvas `destination-out` on the committed view while
provisional (local awaiting-commit + remote in-progress). Brush stays on the
live layer until `operation:committed`. If a committed eraser has fewer points
than the provisional path, keep the provisional hole until `sync_state` /
`history:changed` clears leftovers (`retainProvisionalEraser`).

**Rejected.** Gray pencil preview for eraser. Always discarding provisional
eraser immediately on commit (allowed ink to reappear when batches dropped).

**Verified.** `test/eraser-retain.test.ts`, `test/remote-strokes.test.ts`;
manual eraser opaque-pixel proof in [TESTING.md](./TESTING.md).

## D18 — Gate outbound stroke points until `stroke:start` is accepted

**Problem.** During Connecting…, a local stroke could enqueue points that flushed
after welcome for a `strokeId` the server never saw started, producing
`unknown_stroke` errors and broken peer overlays.

**Selected.** `LiveStrokeTransport` tracks stroke ids whose `stroke:start` was
successfully sent while joined. Points/end for unknown ids are not sent.

**Rejected.** Blindly flushing the batcher whenever the socket opens.

**Verified.** `test/live-stroke-transport.test.ts`.

## D19 — Exclude the departing socket from presence projection

**Problem.** During `webSocketClose` / `webSocketError`, Cloudflare's
`getWebSockets()` can still list the closing socket, so a naïve presence map
kept the leaving participant visible.

**Selected.** Exclude the departing WebSocket / participant id when projecting
presence on close/error.

**Rejected.** Trusting `getWebSockets()` alone without exclusion.

**Verified.** `test/rooms.test.ts` leave/presence cases; issues log in
[ISSUES.md](./ISSUES.md).

## D20 — Colour presets plus custom picker (client-only)

**Problem.** A lone native colour input is slow for demos; presets must not
change the wire protocol or durable colour model.

**Selected.** Five common swatches (`#111827`, `#0f6a5a`, `#1d4ed8`, `#be123c`,
`#b45309`) plus the existing custom `<input type="color">`. Swatches disabled
while eraser is active. Colours still travel as `#RRGGBB` on strokes.

**Rejected.** Server-side palette state. Removing the custom picker.

**Verified.** `test/color-presets.test.ts`; current `client/index.html` markup.

## D21 — Conflict policy is server sequence, not CRDT or pixel merge

**Problem.** Concurrent overlapping strokes need a stable, explainable visual
order without introducing CRDT libraries or unsupported merge claims.

**Selected.** Overlaps are valid. The room Durable Object's single-threaded
commit path assigns one increasing `sequence` per completed op. Clients replay
visible ops in that order. Live overlays are ephemeral and do not participate in
the durable conflict policy.

**Rejected.** CRDT packages. Client-timestamp ordering. Last-writer-wins on
pixels. Claiming unsupported automatic pixel merges.

**Verified.** Overlap cases in `test/history.test.ts`; architecture explanation
in [ARCHITECTURE.md](./ARCHITECTURE.md).

## D22 — Normalized (0–1) stroke coordinates, not raw canvas pixels

**Problem.** Points were captured and persisted as CSS pixels of whatever
canvas box happened to exist when the pointer moved. The operation log is
durable and is replayed later against whatever box exists *then*, so pixels
were only correct by coincidence. Concretely, what breaks with pixel points:

- Resize a 1118×704 window down to a 404×509 phone layout without reloading and
  every committed stroke keeps its old pixel values: ink drawn near the right
  edge is now painted far outside the canvas and simply disappears.
- Rotating a phone (portrait ↔ landscape) shifts the whole drawing instead of
  reflowing it.
- Two participants with different window sizes never agree on where a stroke
  is. A stroke at `x: 900` is mid-canvas for the author and off-screen for a
  peer on a laptop, so the "same" room shows different pictures — which also
  makes invariant 4 (deterministic replay) untrue in practice.
- A rejoin on a differently sized window replays the room's history in the
  wrong place, so reconnect and snapshot restore look broken.

**Selected.** One coordinate space for everything durable or transmitted:
`x` is a fraction of canvas width and `y` a fraction of canvas height. Pixels
exist at exactly two boundaries — `LocalDrawingController.samplePointer`
divides the pointer sample by the canvas box, and `paintStroke` multiplies by
the box supplied to the current paint pass. The same rule covers remote cursor
positions (`RemoteCursorLayer` stores the normalized point and re-places it
against the current overlay box) and any future shape start/end point, because
they travel as the same `StrokePoint`. Stroke **width** stays in CSS pixels so
ink keeps its physical weight, and the input distance filter keeps its 1.5 CSS
px threshold by measuring normalized gaps against the current box.

`PROTOCOL_VERSION` moves `2 → 3`. The bytes on the wire are unchanged, but
their meaning is not, and a cached version 2 client would interpret pixel
values as fractions. Version negotiation is the existing mechanism for exactly
that, and it fails loudly (`protocol_mismatch`) instead of silently painting
garbage. Committed operations stored by older builds keep pixel values; those
demo rooms are abandoned rather than migrated.

DPR is handled by regenerating, never stretching: `applyBackingSize` reassigns
`canvas.width/height` at the new `cssSize × dpr` (which clears the bitmap) and
the layer is then repainted from the normalized log. A `matchMedia`
`(resolution: Ndppx)` listener covers DPR changes that `ResizeObserver` does
not report, such as browser zoom or moving the window to another display.

**Rejected.**

- *Keep pixels, rescale the log on resize.* Every resize would rewrite stored
  operations, accumulating rounding error, and it cannot fix peers whose
  canvases differ from the author's at capture time.
- *Keep pixels, freeze the canvas at a fixed logical size and letterbox.* Simple
  and it preserves aspect ratio, but it wastes screen on phones and contradicts
  D13's canvas-first responsive grid.
- *Store pixels plus the authoring canvas size and scale at replay.* Works, but
  it makes every point carry provenance and leaves two spaces alive in the
  codebase — the mistake is then one forgotten multiply away.
- *Uniform scale (one factor for both axes) instead of per-axis fractions.*
  Keeps stroke shapes undistorted, but leaves ink outside a re-shaped canvas.
  Per-axis reflow was chosen so a drawing always stays fully visible; the
  accepted cost is that a circle becomes an ellipse when the aspect ratio
  changes.

**Verified.** `test/normalized-coords.test.ts`, `test/points.test.ts`,
`test/stroke-paint.test.ts` (same stroke resolved at 800×400 and 400×800);
`npm run typecheck && npm run test && npm run build`. Browser proof on
`wrangler dev`: three strokes committed at 1118×704 CSS / DPR 2 measured an ink
bounding box of `left 0.098, right 0.902, top 0.097, bottom 0.852`; emulating a
404×509 CSS / DPR 3 portrait phone **without reloading** re-measured
`0.095 / 0.904 / 0.096 / 0.853`. A touch stroke drawn at 5–95% width in
portrait re-measured at `left 0.048, right 0.951` after returning to landscape.
See [TESTING.md](./TESTING.md).

## D23 — Canvas-dominant mobile shell (drawer + floating toolbar)

**Problem.** On phones the previous responsive grid still stacked invite,
presence, and tools above/below the stage, so drawing lost most of the dynamic
viewport once mobile browser chrome appeared. `100vh` also ignored URL-bar
show/hide.

**Selected.** At `≤640px` wide **or** short landscape (`max-height: 500px` and
`max-width: 960px`): `100dvh` app height; invite + presence collapse into one
**Room** sheet closed by default; toolbar becomes a slim semi-transparent bar
over the stage bottom. Desktop stays stacked. Resize /
`orientationchange` / `visualViewport` regenerate the DPR bitmap and replay
normalized ops (depends on D22).

**Rejected.** Permanently hiding invite/presence on mobile (hurts the share
demo). A bottom sheet that always reserves height (defeats canvas dominance).
Width-only `max-width: 640px` (phone landscape often exceeds 640px and would
fall back to the desktop stack).

**Verified.** Local emulator: portrait 390×844 stage ~84% of viewport, toolbar
`position: absolute` over stage, Room sheet closed by default and expands on
tap; landscape 844×390 stays on the mobile shell with stage ~80%; ink bounding
fractions held across the rotate (see TESTING 26 July 2026).

## D25 — Finger-first tablets use the mobile room shell

**Problem.** iPads matched the desktop chrome (width >640px), so the invite URL
field stayed visible and Safari select-all stole finger draws (I20).

**Selected.** Extend the mobile media query / `MOBILE_SHELL_QUERY` with
`(hover: none) and (pointer: coarse) and (max-width: 1180px)` so typical iPads
get the Room sheet + floating toolbar. Keep desktop stacked chrome for mouse
and large displays.

**Rejected.** Leaving iPad on desktop chrome and only CSS-hardening the invite
field (still easy to graze). Forcing the shell for every width ≤1180px (punishes
narrow desktop windows with a mouse).

**Verified.** MatchMedia checks under iPad metrics; see I20 / TESTING.

## D24 — Rectangle as one sequenced op, not live frames

**Problem.** A shape tool must collaborate and undo/redo like strokes without
flooding the room with intermediate geometry.

**Selected.** `shape:rect` carries normalized `start`/`end`, colour, and width.
Drag preview is local only; pointer-up commits one durable `kind: "rect"` row
in the same append-only log. Undo/redo and sequence layering need no new
machinery (`PROTOCOL_VERSION` 4).

**Rejected.** Live fan-out of every resize frame (bandwidth and flicker). A
separate shape store or CRDT (overkill vs the existing sequenced log).

**Verified.** `test/shape-rect.test.ts` two-client commit + undo; protocol parse
tests; manual two-tab draw/undo.

## Deferred

These remain intentionally unimplemented:

- Sticky participant identity / colour across reconnect
- Checkpoint / retention for very large operation logs (after measured replay cost)
- Delta-by-`lastSequence` join once a versioned visibility token exists
- Network-chaos demo controls, replay UI, and other stretch blueprint items
