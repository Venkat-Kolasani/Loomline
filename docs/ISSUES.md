# Issues log (interview prep)

Use this file to answer: **“What issues did you run into while building this?”**

Each entry is a real problem we hit, not a hypothetical. Keep entries honest and
short enough to rehearse aloud.

**How to use in an interview**

1. Pick 1–2 entries that match the question (realtime, Canvas, Workers, testing).
2. Say the symptom → root cause → fix → why that fix (not a longer alternative).
3. Mention how you verified (test, two-browser check, etc.).

Agents must append here whenever a real bug, tooling failure, or surprising
platform behavior is discovered and fixed. See `AGENTS.md`.

---

## I1 — Departed users stayed in presence lists

**When:** Prompt 4 (rooms + presence), after first browser two-client check.

**What the issue was**

Closing or navigating away client B left B visible on client A’s presence list
(reproduced ~1.5s later). Join looked correct; leave did not.

**Root cause**

In the Durable Object hibernation API, `webSocketClose` / `webSocketError` run
while the departing socket is **still** returned by `ctx.getWebSockets()`. We
broadcast a full presence list built from that set, so the leaver was included.

**What we fixed**

Pass the departing socket (and its participant id) into presence projection and
skip them when listing and broadcasting. Covered close and error with two-client
integration tests (`test/rooms.test.ts`). Error path uses a DO-only
`/test/simulate-ws-error` helper so we can invoke `webSocketError` without a
real transport fault.

**Why this way**

- Exclusion at broadcast time matches the platform lifecycle (socket still in
  the set during the handler) without fighting the runtime.
- Filtering by socket identity + participant id is cheap and deterministic.
- Rejected “wait until the socket disappears then broadcast” — racey and hard
  to test.
- Rejected a separate in-memory presence Set — would duplicate attachment state
  and break across hibernation unless also persisted.

**Verification**

Automated close + error tests; browser: two tabs in one room, close B → A shows
only self. Commit: `fd7dc46`.

---

## I2 — Room reuse left stale client identity and connection status

**When:** Prompt 4 review (P2), before stroke sync.

**What the issue was**

`enterRoom()` cleared the visible presence list but kept `selfParticipant` and
local canvas ink. An old socket’s `close` handler could still fire and set
connection status to “Disconnected” after a newer connection had started.

**Root cause**

Room UI was written for full-page navigation first; handlers closed over sockets
without a “still current?” check, and enter/leave did not reset all room-scoped
state.

**What we fixed**

On enter and on return to landing: clear self, presence UI, and local ink.
`RoomSocket.disconnect()` nulls the active socket **before** `close()`, and all
socket / room handlers ignore events when the socket (or `roomSocket` instance)
is no longer current.

**Why this way**

- Same pattern you need for reconnect and in-app room switches later.
- Superseded-socket guards are local and easy to explain; no global event bus.
- Rejected only fixing the status label — identity and ink would still leak
  across rooms.

**Verification**

`typecheck` / `test` / `build` after the change. Commit: `841c521`.

---

## I3 — Local Wrangler died with Durable Object `SQLITE_BUSY`

**When:** Local `wrangler dev` during rooms work (multiple restarts / overlapping
processes).

**What the issue was**

Dev server crashed with `database is locked: SQLITE_BUSY` (sometimes
`SQLITE_BUSY_RECOVERY`) in workerd’s DO SQLite. Port 8787 went down mid-session.

**Root cause**

Local Durable Object SQLite under `.wrangler/state` does not tolerate concurrent
`wrangler`/`workerd` processes (or a dirty lock after a hard kill) well. This is
**two local Wrangler processes contending for the same DO SQLite files**, not an
application-code defect in presence or rooms.

**What we fixed (ops, not product code)**

Stop leftover wrangler/workerd processes, clear `.wrangler/state` when locked,
restart a **single** `npm run dev`. Do not run two Wrangler instances on the
same project directory.

**Why this way**

- The lock is a local-dev artifact, not a production multi-DO design bug.
- Clearing state is safe for an assignment demo (rooms are ephemeral locally).
- Rejected “ignore and keep hacking” — leads to flaky browser proofs.

**Verification**

Fresh `npm run dev` reaches `Ready on http://127.0.0.1:8787` and WebSocket
joins succeed again.

---

## I4 — Scaffold DO test broke when rooms stopped returning JSON 200

**When:** Prompt 4 — Room DO became WebSocket-only for normal fetches.

**What the issue was**

`test/scaffold.test.ts` expected the DO stub to return JSON `{ ok, role,
status: "skeleton" }` with status 200. After rooms, non-upgrade fetches return
**426 Expected WebSocket**.

**Root cause**

The product surface changed; the scaffold test still described the skeleton API.

**What we fixed**

Update the test to assert **426** for non-WebSocket fetches (correct contract
for a WS-only DO entry).

**Why this way**

- Tests should document the real boundary, not preserve obsolete stubs.
- Rejected keeping a fake JSON health on the DO — would confuse the public
  Worker vs DO responsibilities (`/api/health` stays on the Worker).

**Verification**

Scaffold + rooms suites green together.

---

## I5 — `setPointerCapture` threw under synthetic / touch-emulation events

**When:** Local drawing / touch emulation proof.

**What the issue was**

Some environments reject `setPointerCapture` for non-trusted or synthetic
pointer events, which could abort stroke start if uncaught.

**Root cause**

Pointer capture is best-effort for UX (drag outside the canvas); it is not
required for on-target drawing.

**What we fixed**

Wrap `setPointerCapture` / `releasePointerCapture` in try/catch; continue the
stroke on the target element when capture is refused.

**Why this way**

- Drawing correctness does not depend on capture.
- Rejected requiring trusted events only — would make automated/touch
  emulation proofs brittle.

**Verification**

Pointer / touch-emulation drawing still completes strokes on the live layer.

---

## I8 — Live-end provisional ink raced ahead of durable commit

**When:** Prompt 6 (durable ops), client redesign.

**What the issue was**

Remote `stroke:live` `phase:end` previously painted finished ink onto a
provisional committed list. After durable ops landed, that could double-paint or
diverge from server sequence until refresh.

**Root cause**

Slice 5 retained finished remotes client-side because nothing durable existed
yet. Slice 6 introduced `operation:committed` as the sole committed source.

**What we fixed**

Remote live-end only clears the live overlay. Committed pixels come only from
`sync_state` / `operation:committed`. Local finished strokes wait on the live
layer (`awaitingCommit`) until the matching commit arrives.

**Why this way**

- One authoritative paint path for committed-canvas.
- Rejected keeping provisional + committed merge — layering bugs under overlap.

**Verification**

History integration tests + two-browser overlap proof.

---

## I7 — Stroke started while Connecting… orphaned points after welcome

**When:** Prompt 5 review (P1), before durable history.

**What the issue was**

Drawing during “Connecting…” kept local ink. `stroke:start` was dropped because
the socket was not ready, but later `stroke:points` still entered the rAF
batcher. After `welcome`, those batches (and sometimes `stroke:end`) reached the
server without an active stroke → `unknown_stroke`. Peers never saw the stroke.

**Root cause**

Network hooks gated **start** (and end) on `isReady()`, but **points** only
checked that the socket instance was current, so the batcher could flush after
join.

**What we fixed**

`LiveStrokeTransport` records stroke ids whose `stroke:start` was actually sent
while ready. Points and end are suppressed unless that stroke id was accepted.
Regression: `test/live-stroke-transport.test.ts`.

**Why this way**

- Keeps local drawing enabled during connect (responsive UX).
- Rejected only “disable pointer until welcome” — still need the accepted-start
  gate if hooks are wired mid-stroke after welcome.
- Rejected buffering start until welcome — more state, easy to mis-order with end.

**Verification**

Unit regression: start while not ready → welcome → points/end send nothing.
`npm run typecheck && npm run test && npm run build`.

---

## I6 — Landing and room views both painted because `[hidden]` lost to `.app`

**When:** Prompt 5 (live strokes), first browser proof on `/`.

**What the issue was**

The landing page and the room shell rendered stacked on `/`. Room status showed
“Disconnected” even though `routeFromLocation` never called `enterRoom`.

**Root cause**

Author rule `.app { display: grid }` overrides the user-agent stylesheet’s
`[hidden] { display: none }` (same specificity; author wins). The room view kept
the `hidden` attribute but was still laid out.

**What we fixed**

Add an explicit author rule:

```css
[hidden] {
  display: none !important;
}
```

**Why this way**

- Restores the HTML `hidden` contract without restructuring view CSS.
- Rejected toggling only a `.is-visible` class — would diverge from the existing
  `hidden` attribute pattern on `#view-landing` / `#view-room`.

**Verification**

Reload `/` → only landing visible; create room → only room visible. Live stroke
proof proceeds on that layout.

## I7 — Local wrangler crash: `SQLITE_BUSY_RECOVERY` mid two-browser proof

**When:** Prompt 7 (undo/redo) two-browser proof, 25 July 2026.

**What the issue was**

During an earlier local session, both browser tabs flipped to Disconnected and
`wrangler dev` exited. Runtime stderr:

`SQLite failed; database is locked: SQLITE_BUSY (extended: SQLITE_BUSY_RECOVERY)`
followed by “The Workers runtime failed to start.”

**Root cause**

Local workerd DO SQLite became busy/recovering while the miniflare isolate was
reloading (log showed `Reloading local server…` immediately before the fatal
exception). Open WebSockets dropped when the runtime died — not an application
protocol bug in undo/redo.

**What we fixed**

No product code change. Restarted `npm run dev` on a clean local state and
re-ran the two-browser undo/redo proof successfully (`TESTING.md`).

**Why this way**

Restarting local DO storage is appropriate for a tooling lock; rewriting
history to avoid SQLite would weaken the durable-op contract. Production Workers
SQLite is not this local miniflare file lock path.

**Verification**

Room `undo7a01` on `http://localhost:8787`: peer undo cleared both canvases;
redo restored matching opaque counts on both tabs while Connected.

Recurred 25 July during Prompt 8 reconnect proof after `npm run build` triggered
`Reloading local server…` — same SQLITE_BUSY fatal. Workaround: avoid rebuilding
while an active `wrangler dev` two-browser session is open; restart `npm run
dev` cleanly for the next manual check.

## I8 — Live-stroke expiry failed after WebSocket hibernation

**When:** Prompt 8 review (P1), before Prompt 9.

**What the issue was**

`liveStrokes` lived only in memory. Hibernatable WebSockets stay connected while
Cloudflare evicts the DO and resets in-memory state. A 30s alarm wake then saw
an empty map, so peers could keep a stuck live stroke forever. The original
expiry test never evicted the instance, so it could not catch this.

**Root cause**

Expiry depended on ephemeral map entries. Durable Object hibernation does not
preserve those entries; only SQLite / attachments / alarms survive.

**What we fixed**

SQLite table `live_stroke_expiry` stores participant id, stroke id, room id, and
`expires_at` (no points). Upserted on start/points; deleted on end/close/expire.
Alarm reads expired rows, broadcasts `stroke:live` end, notifies the author, and
deletes rows. Constructor re-arms the alarm from remaining rows. Integration
test: `evictDurableObject` + `runDurableObjectAlarm`.

**Why this way**

Keeps the “do not persist live pointer points” rule while making expiry survive
hibernation. Rejected attaching full point lists to WebSocket attachments — too
large and still would not help peer clear without an alarm payload.

**Verification**

`test/live-expiry-hibernate.test.ts` (52 tests total). Docs: ARCHITECTURE,
PROTOCOL, DECISIONS D6, TESTING.

## I8 — Clear only wiped uncommitted live ink

**When:** manual testing after observability (2026-07-25)

**What the issue was**
After finished (committed) strokes, **Clear** appeared to do nothing — ink stayed
on the canvas.

**Root cause**
The click handler only called `drawing.clearLocal()`, which drops active /
awaiting-commit strokes on the live layer. Committed ops live in
`CommittedOperationStore` and paint the committed canvas, so Clear never touched
what users actually saw.

**What we fixed**
Local Clear also clears the local committed store and remote live overlays, then
marks both layers dirty. Still no server message — peers and room history are
unchanged; rejoin / `sync_state` restores ops.

**Why this way**
Matches documented “local-only clear” without making Clear global undo. Rejected
a server wipe (would break collaboration invariants).

**Verification**
Manual: commit a stroke → Clear → this client’s canvases empty; peer unchanged.

## I9 — `rate_limited` looked like a connection failure

**When:** manual / `?debug=1` after Prompt 9 rate limits (2026-07-25)

**What the issue was**
Status showed `Error: rate_limited` even though the WebSocket stayed open and
drawing continued.

**Root cause**
Client `onError` treated every typed server `error` as fatal UI state, including
recoverable boundary codes (`rate_limited`, `invalid_json`, etc.).

**What we fixed**
Those codes no longer change connection status; status stays Connected while the
socket is open. Server limiter unchanged.

**Why this way**
Anti-abuse replies are not disconnects. Rejected a user-facing toast — noisy for
an intentional flood budget users should not hit in honest drawing.

**Verification**
`npm run typecheck && npm run test && npm run build`.

## I10 — Eraser preview looked like a soft gray pencil

**When:** Manual tool check before submission polish (2026-07-26)

**What the issue was**
Dragging the eraser painted a translucent gray stroke on the live layer instead
of punching through committed ink. Only after `operation:committed` did holes
appear. Width slider worked but felt unused because the preview ignored
destination-out.

**Root cause**
`paintStroke(..., "preview")` used `source-over` + gray for eraser. Local and
remote live painters always called preview mode, so mid-drag never hit
`destination-out` (reserved for `"final"` on the committed store).

**What we fixed**
Eraser always paints with `destination-out`. Provisional erasers (active,
awaiting-commit, remote live) paint on the **committed** pass; live overlay is
brush-only. Eraser cursor is an SVG circle sized to the shared width slider.

**Why this way**
Keeps server-owned eraser ops (undo/sequence) while making drag feel like a
real eraser. Rejected a local-only pixel wipe that skipped commits — would break
collaborative history.

**Verification**
`test/stroke-paint.test.ts`, `test/remote-strokes.test.ts`;
`npm run typecheck && npm run test && npm run build`; manual: brush ink → eraser
drag punches through at multiple widths.

## I11 — Erased ink bits reappeared after commit

**When:** Immediately after punch-through eraser (I10), 2026-07-26

**What the issue was**
Dragging the eraser punched a clean hole, then after `operation:committed` a
few bits of the erased ink came back along the path.

**Root cause**
Local/provisional eraser often had more points than the durable op. During a
stroke the client sent ~1 `stroke:points` + ~1 `cursor` per frame (≈120/s),
saturating `MAX_MESSAGES_PER_WINDOW`, so some point batches were dropped while
local ink kept the full path. On acknowledge the shorter committed eraser
replaced the provisional hole and ink "grew back." Trailing tip loss (no
pointerup point on `stroke:end`) and unchunked >64-point flushes could also
shorten the commit.

**What we fixed**
- Skip cursor sends while drawing (rate-limit headroom for points).
- Chunk `StrokePointBatcher` flushes to `MAX_POINTS_PER_MESSAGE`.
- Include filtered pointerup tip on local stroke + `stroke:end`.
- Keep provisional eraser (local + remote) when committed point count is
  shorter; clear leftovers on `sync_state` / `history:changed`.
- Append remote `stroke:live` end points onto provisional erasers.

**Why this way**
Preserves server-owned eraser ops (no local-only wipe). Rejected only
re-painting from local geometry into the store — that would diverge peers and
undo. Keeping the longer provisional hole until coverage matches (or history
resync) is safe `destination-out` layering.

**Verification**
`test/eraser-retain.test.ts`, `test/stroke-batcher.test.ts` chunk case;
`npm run typecheck && npm run test && npm run build`; manual: brush then erase
a long stroke — hole must not shrink after the stroke commits.

---

## I18 — Committed strokes were pinned to the canvas size that drew them

**When:** 26 July 2026, coordinate-space slice.

**What the issue was**

Points were stored and transmitted as CSS pixels of the canvas box that existed
at capture time, while the operation log is durable and gets replayed against
whatever box exists later. Resizing the window without reloading left ink
sitting at its old pixel coordinates: strokes near the right or bottom edge of
a wide window were painted outside a narrower canvas and vanished. The same
bug meant two peers with different window sizes never saw the same picture, and
a rejoin on a resized window replayed history in the wrong place.

**Root cause**

There was only one coordinate space in the system — the author's pixels — and
`paintStroke` consumed those numbers directly. Nothing converted between the
canvas that captured a point and the canvas that painted it.

**What we fixed**

`client/src/canvas/normalized-coords.ts` defines a fraction-of-the-box space.
Pointer samples are divided by the canvas box in
`LocalDrawingController.samplePointer`; painting multiplies by the box passed to
the current paint pass (`paintStroke(ctx, stroke, space)`), and remote cursors
store the normalized point and re-place on resize. `PROTOCOL_VERSION` moved
`2 → 3` so a cached pixel-space client cannot mix spaces in a room.

**Why this way**

Rescaling the stored log on every resize accumulates rounding error and still
cannot fix peers whose canvases differed at capture time; freezing a logical
canvas and letterboxing wastes phone screen and contradicts D13. Normalizing at
the two boundaries leaves exactly one durable space. Full trade-off: D22.

**Verification**

`test/normalized-coords.test.ts`, `test/points.test.ts`,
`test/stroke-paint.test.ts`; `npm run typecheck && npm run test && npm run
build`; browser on local `wrangler dev` — ink bounding box measured at
`0.098/0.902/0.097/0.852` on a 1118×704 CSS canvas (DPR 2) re-measured at
`0.095/0.904/0.096/0.853` after emulating a 404×509 CSS portrait phone
(DPR 3) with no reload.

---

## I19 — `npm run typecheck` never actually typechecked the tests

**Status (27 July 2026 — submission decision):** **Accepted / deferred past
feature freeze.** Still open by design: app sources are `tsc`-checked; specs
are gated by Vitest only. Formalized as [DECISIONS.md](./DECISIONS.md) D27.
Not a silent gap for Prompt 12 audits.

**When:** 26 July 2026, discovered while migrating call sites for I18.

**What the issue was**

`npm run typecheck` runs `tsc -p test/tsconfig.json` and reported success even
though several specs called `paintStroke` with the old argument order. Stale
test call sites could only be caught by running Vitest.

**Root cause**

`test/tsconfig.json` extends the root config, and `extends` inherits `exclude`.
The root config excludes `test`, and those relative paths resolve against the
root config, so every spec was excluded from its own project.
`tsc -p test/tsconfig.json --listFiles | grep -c /test/` returns `0`.

**What we fixed**

Nothing in production code — deliberately accepted for submission. Probing
`"exclude": []` on 27 July still surfaces ~40 pre-existing errors in specs
(`cloudflare:test` module types, `CommittedOperation` narrowing,
`fetch` arity under Workers types). Cleaning that is a post-freeze chore, not
a must-ship blocker: **test files are checked by Vitest at runtime, not by
`tsc`.** Root `tsc` still typechecks `client/`, `worker/`, and `shared/`.

**Why this way**

Bundling an unrelated multi-file test typing cleanup into a feature slice would
make the diff unreviewable. Landing `"exclude": []` with a red typecheck
violates the "never commit a known failure" rule. Vitest already executes every
spec under the Workers pool, which is the evidence gate for collaboration
behavior.

**Verification**

`npx tsc --noEmit -p test/tsconfig.json --listFiles | grep -c "/test/"` → `0`
(gap confirmed). Coordinate migration was verified by the Vitest suite plus
browser proof. Re-probed 27 July with a temporary exclude override: ~40 errors;
decision left in place (D27).

---

## I17 — Metrics pings could drop stroke:end (ghost local ink)

**When:** 26 July 2026 systematic multi-client acceptance / browser proof.

**What the issue was**

A peer (or Node observer) sometimes saw `stroke:live` `start` only. The drawer
kept local ink after pointer-up, but Undo stayed disabled and
`/api/room-metrics` showed no new committed operation.

**Root cause**

Per-participant rate limiting counted **every** joined frame before parse,
including valid `ping`. The always-on Metrics dock sent RTT pings every 2s while
connected. Under slow frames / long strokes that budget could fill so
`stroke:points` / `stroke:end` returned `rate_limited`. The client had already
moved the stroke into awaiting-commit, so ink looked stuck with no server seq.

**What we fixed**

1. Ping only while the Metrics `<details>` is expanded (same policy as Display
   rAF sampling).
2. Exempt **valid** `ping` from the drawing rate-limit budget; still count
   binary / malformed / oversized floods.
3. On `rate_limited` / `unknown_stroke` / `stroke_expired`, abandon local
   uncommitted ink so ghost brushes do not linger.

**Follow-up (same day):** Valid protocol messages are no longer rate-limited at
all — only abuse frames consume the 120/s budget — so normal drawing cannot hit
`rate_limited` even if Metrics is open or pointer traffic is dense.

**Why this way**

Dropping diagnostics traffic during drawing is cheaper than raising the global
cap. Keeping anti-abuse on garbage frames preserves invariant 10. Clearing
provisional ink on those errors is better than leaving an un-undoable ghost.

**Verification**
`test/boundaries.test.ts` “valid burst never rate-limited” + “ping flood does
not block stroke commit”; `npm run typecheck && npm run test && npm run build`;
browser: draw with Metrics collapsed → peer live ink + Undo enables after
pointer-up.

---

## I20 — iPad finger draw selected the invite URL / empty-state text

**When:** 26 July 2026, user report on physical iPad.

**What the issue was**
Starting a stroke with a finger selected a text box (often select-all on the
invite URL) or highlighted the centered empty-state copy, so drawing felt
broken.

**Root cause**
iPad widths (>640px) used the desktop stacked chrome, so the readonly invite
`<input>` sat above the canvas and Safari selects-all on tap/focus. Long-press
draw also selected overlay text because empty-state lacked `user-select: none`
(pointer-events: none alone does not block Safari selection).

**What we fixed**
Stage/canvas/empty-state/toolbar/invite field refuse user-select and touch
callouts; invite input is `tabindex="-1"` and ignores accidental focus except
the copy/share fallback; pointerdown on the canvas blurs active form controls;
mobile shell also matches finger-first tablets (`hover: none` + `pointer: coarse`
up to 1180px) so invite stays behind Room.

**Why this way**
Keeping a real input for clipboard fallback is simpler than a second control;
blurring on draw start covers width slider focus without hiding controls.

**Verification**
`npm run typecheck && npm run test && npm run build`; DevTools iPad metrics +
`(hover: none) and (pointer: coarse)` confirms Room sheet shell; re-test finger
draw on device after deploy.

**Follow-up (same day)**
Mobile + Apple Pencil still selected the centered empty-state *box* because
Safari starts selection on `touchstart` before `pointerdown`, and DOM text
remains selectable even with `pointer-events: none`. Empty-state copy moved to
CSS `::before` (no text node); non-passive `touchstart`/`touchmove` +
`selectstart` guards clear selection; `#view-room` / stage use
`touch-action: none`. Deployed with this slice.

## I21 — Arrow shaft round-cap poked past the arrowhead tip

**When:** 27 July 2026, after shape tools (line / ellipse / arrow) landed.

**What the issue was**

Drawn arrows showed a small blunt/rounded “nose” sticking out past the sharp
triangular head.

**Root cause**

`paintArrow` stroked the shaft all the way to the tip (`end`) with
`lineCap: "round"`, then filled the head triangle on the same tip. The round
cap is a half-disk centered on `end`, so it protrudes beyond the triangle apex.

**What we fixed**

Stop the shaft at the head base (inset by `headLen` along the start→end vector)
so the round cap sits under the filled triangle, not past the tip
(`client/src/canvas/stroke.ts`). Paint test updated to expect the inset endpoint.

**Why this way**

Shortening the shaft keeps the existing filled-triangle head and round start
cap. Switching only to `lineCap: "butt"` would still leave a flat stub at the
tip unless the shaft is inset; butt alone also looks worse at the start.

**Verification**

`npx vitest run test/stroke-paint.test.ts`; `npm run typecheck && npm run build`.

---

## I22 — Shapes flyout covered the invite/share row

**When:** 27 July 2026, after the Shapes flyout replaced the standalone Rectangle
control.

**What the issue was**

Opening Shapes placed the four shape icons over “Invite collaborators” and the
share-link input; the room URL was partially unreadable until the flyout closed.

**Root cause**

`.shape-flyout` used `bottom: calc(100% + …)`, so it anchored **above** the
Shapes trigger. On desktop the toolbar sits under the invite/share chrome, so
“up” meant into that row, not into empty canvas.

**What we fixed**

Default (desktop): open **down** with `top: calc(100% + …)`. Mobile media
query: keep **up** into the stage because the floating toolbar sits at the
canvas bottom (`client/src/styles.css`).

**Why this way**

Direction follows toolbar placement rather than one absolute rule. A higher
`z-index` alone would still obscure the share link; flipping open direction
fixes readability without moving invite chrome.

**Verification**

`npm run typecheck && npm run test && npm run build`; visual check that desktop
Shapes opens toward the canvas and the share URL stays fully readable.

---

## I23 — Double-arrow flyout label leaked on mobile (“or” ghost text)

**When:** 27 July 2026, after biarrow icon polish on small/mobile toolbar.

**What the issue was**

On the floating mobile toolbar, the double-arrow flyout (and trigger) showed
faint grey letters (“or”) behind the icon, looking corrupted.

**Root cause**

Shape flyout buttons are CSS grid cells containing both the SVG and a
`visually-hidden` “Double arrow” span. On WebKit mobile, `clip: rect(0,0,0,0)`
is unreliable, so the longer label stayed partially visible under the icon.

**What we fixed**

Moved accessible names to `aria-label` on each flyout button and removed the
spans. Hardened `.visually-hidden` with `clip-path: inset(50%)`. Clipped flyout
item overflow. Replaced the biarrow glyph with a horizontal filled double-head
icon that stays clear at 18px.

**Why this way**

`aria-label` on icon-only buttons is the usual pattern and cannot paint into the
grid cell. Keeping a clipped span would still fight WebKit’s `clip` quirks.

**Verification**

`npm run typecheck && npm run test && npm run build`; mobile-width check that
biarrow shows no ghost text.

---

## I24 — Mobile shapes flyout clipped by toolbar overflow

**When:** 27 July 2026, after the floating mobile toolbar + upward flyout.

**What the issue was**

Tapping Shapes on mobile activated the tool but the icon grid never appeared
above the bar.

**Root cause**

`.toolbar` uses `overflow-x: auto` for horizontal scrolling. Per CSS, that
forces `overflow-y` clipping as well, so the absolutely positioned flyout
(opening upward out of the bar) was painted inside the clipped box and looked
missing.

**What we fixed**

On the mobile shell, while the flyout is open, pin it with `position: fixed`
from the trigger’s `getBoundingClientRect` (and re-sync on resize/toolbar
scroll). Desktop keeps the normal absolute layout under the toolbar.

**Why this way**

`overflow-x: auto; overflow-y: visible` is invalid (browsers coerce y to auto).
Moving scroll to an inner wrapper still clips if the flyout stays inside that
wrapper. Fixed positioning escapes the clip without changing toolbar UX.

**Verification**

`npm run typecheck && npm run test && npm run build`; mobile shell: open Shapes
and confirm the 4×2 grid appears above the floating bar.

---

## I25 — iPhone Safari still hid the shapes flyout (fixed + backdrop-filter)

**When:** 27 July 2026, after I24’s `position: fixed` fix; reproduced on iPhone
Safari.

**What the issue was**

Shapes tool activated on iPhone, but the flyout grid still never appeared.

**Root cause**

iOS Safari treats an ancestor with `backdrop-filter` / `-webkit-backdrop-filter`
as a containing block for `position: fixed`. The floating toolbar uses blur, so
the “fixed” flyout stayed trapped (and clipped) inside the toolbar.

**What we fixed**

While the mobile shell flyout is open, reparent `#shape-flyout` to
`document.body`, position it with viewport coordinates from the trigger, then
restore it under `#shape-tool` on close. Ignore outside-dismiss for ~450ms so
iOS does not close on the opening gesture.

**Why this way**

Removing toolbar blur would regress the floating chrome. An inner scroll wrapper
still fails if the flyout remains under `backdrop-filter`. Portaling to `body`
is the reliable escape hatch.

**Verification**

`npm run typecheck && npm run test && npm run build`; iPhone Safari: tap Shapes
and confirm the icon grid appears above the toolbar.

---

Copy this block when logging a future issue:

```markdown
## I# — Short title

**When:** prompt / date / slice

**What the issue was**
Symptom a reviewer or user would see.

**Root cause**
Technical reason in one short paragraph.

**What we fixed**
Concrete change (files/behavior).

**Why this way**
Why this fix beat at least one alternative.

**Verification**
Commands, tests, or browser steps + commit if any.
```
