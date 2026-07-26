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

**Why this way**

Dropping diagnostics traffic during drawing is cheaper than raising the global
cap. Keeping anti-abuse on garbage frames preserves invariant 10. Clearing
provisional ink on those errors is better than leaving an un-undoable ghost.

**Verification**
`test/boundaries.test.ts` “ping flood does not block stroke commit”;
`npm run typecheck && npm run test && npm run build`; browser: draw with Metrics
collapsed → peer live ink + Undo enables after pointer-up.

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
