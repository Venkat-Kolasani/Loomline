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
