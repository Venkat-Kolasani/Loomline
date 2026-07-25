# Testing

Evidence log for Loomline. Record **exact commands and outcomes**. Do not claim
untested behavior.

## Automated commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Clean install from lockfile |
| `npm run typecheck` | TypeScript for app + tests |
| `npm run test` | Vitest + `@cloudflare/vitest-pool-workers` |
| `npm run build` | Vite production build → `dist/client` |
| `npm run dev` | Build client, then `wrangler dev` |

## Manual checklists

### Two-browser collaboration

- [x] Two clients same room see each other in presence
- [x] Different room ids do not share presence
- [x] Leaving client is removed from remaining clients’ presence
- [x] Live strokes sync mid-stroke (peer sees ink before pointer up)
- [x] Finished strokes persist via operation:committed (same sequence on both)
- [x] Joining client receives sync_state matching committed log
- [ ] Global undo/redo matches on both
- [x] Refresh/rejoin restores committed canvas via sync_state (full snapshot on
  join; reconnect backoff / last-sequence resume deferred to Prompt 8)
- [x] Malformed stroke payload returns typed error; room survives (automated)
- [x] Mid-stroke close does not create a durable op (automated)
- [x] Brush then eraser overlap keeps sequence order (automated)

### Touch / mobile

- [x] Touch drawing path exercised via PointerEvent emulation (earlier slice)
- [ ] Controls usable on narrow viewport (spot-check later)

### Deployed smoke

- [ ] Fresh session on live URL loads
- [ ] Two clients against deployed origin

## Results — live stroke streaming (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  7 passed (7)
Tests  31 passed (31)
exit 0
```

Includes:

- `test/protocol.test.ts` — versioned message validation (join, stroke, cursor, rejects)
- `test/stroke-batcher.test.ts` — at most one outbound points batch per rAF
- `test/live-strokes.test.ts` — peer receives `stroke:live` start/points before end;
  invalid color → typed `error`; room still accepts a later valid stroke;
  cursor fan-out

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker + two-browser mid-stroke proof

```text
Ready on http://127.0.0.1:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"live-strokes"}
One workerd listener on :8787
```

Manual / browser automation (room `06c902e9`):

1. Tab A (`Artist-dfc6`) and Tab B (`Artist-2412`) both Connected; presence = 2.
2. Tab A synthetic pointerdown + moves **without** pointerup.
3. Tab B live-canvas had **3894** opaque pixels **before** A ended the stroke;
   empty-state hidden; remote cursor label `Artist-dfc6` visible at stroke tip.
4. Screenshot evidence: peer canvas shows brown in-progress stroke + cursor.

Invariant protected: local pixels before network; remote in-progress ink on
live overlay only; no durable sequence in this slice.

Also fixed I6: author `.app { display: grid }` overrode UA `[hidden]`; added
`[hidden] { display: none !important; }` so landing/room do not stack.

### P1 — Connecting race gate (2026-07-25)

**Bug:** stroke started before `welcome` dropped `stroke:start` but still queued
`stroke:points`; after join, batches hit `unknown_stroke`.

**Fix:** `LiveStrokeTransport` only forwards points/end for stroke ids whose
start was accepted while ready. Test: `test/live-stroke-transport.test.ts`.

### Prompt 9 hardening note (not done here)

`StrokePointBatcher` does not yet chunk or enforce the documented 64-point
maximum client-side. Normal pointer rates stay under the limit; add an explicit
chunking/size-limit test before claiming the payload boundary is fully hardened.

## Results — durable ordered operations (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0.

### `npm run typecheck` / `test` / `build`

```text
typecheck exit 0
Test Files  10 passed (10)
Tests  39 passed (39)
build exit 0
```

Includes `test/history.test.ts`:

- two clients see the same increasing sequences for overlapping strokes
- joining client `sync_state` matches the committed log
- mid-stroke close abandons live ink (sequenceHead stays 0)
- brush then eraser overlap commits as sequences 1 then 2
- back-to-back `stroke:end` without awaiting the first commit still yields
  distinct sequences 1 and 2

Adversarial coverage in the same suite / prior transport tests:

- Connecting→connected during a stroke: `LiveStrokeTransport` suppresses
  points/end when start was not accepted (no orphan unknown_stroke / no false
  awaiting-commit).
- Socket close mid-stroke: no durable op.
- Back-to-back ends (no await between first end and second start): sequences
  1,2 without collision.
- Two users brush/eraser on overlapping content: stable server order.

### Local two-browser proof

```text
GET /api/health → {"ok":true,"service":"loomline","phase":"durable-ops"}
Room 26a9b7be
```

1. Tab A (`Artist-3f37`) drew a completed stroke; Tab B (`Artist-8251`) showed
   **5374** opaque pixels on **committed-canvas** and **0** on live (durable).
2. Tab C (`Artist-3349`) joined later — same **5374** committed opaque pixels
   via `sync_state`; presence = 3.
3. Undo/Redo remain disabled (out of scope).

## Results — rooms + presence (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  4 passed (4)
Tests  17 passed (17)
exit 0
```

Includes `test/rooms.test.ts`:

- two `idFromName` rooms keep isolated Durable Object storage marks
- two-client presence: closing client B removes B from A’s presence list
- two-client presence: simulated `webSocketError` for B removes B from A’s list

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker + browser

```text
Ready on http://localhost:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"rooms-presence"}
```

Manual: create room A, open same `/r/<id>` in second context → presence shows
two participants. Open room B → presence isolated from A.

Manual leave regression (fix verification): with two clients in one room, close
or navigate away client B → client A’s presence list drops B (no stale entry).

### Presence leave fix (2026-07-25)

**Problem:** `webSocketClose` / `webSocketError` called `broadcastPresence` while
the departing socket was still in `ctx.getWebSockets()`, so other clients kept
seeing the leaver.

**Fix:** pass `excludeSocket` + `excludeParticipantId` into presence projection
and skip the departing socket when broadcasting.

**Verification:** `npm run typecheck && npm run test && npm run build` — 17/17.

### Client room reuse reset (2026-07-25)

**Problem:** `enterRoom()` cleared the visible presence list but kept
`selfParticipant` and local canvas ink; an old socket’s close could overwrite
the new connection status.

**Fix:** reset self/presence/ink on enter and leave; `RoomSocket` and room
handlers ignore events from superseded sockets.

**Verification:** `npm run typecheck && npm run test && npm run build` (Prompt 4
gate re-run after both fixes) — typecheck exit 0; Tests 17 passed (17); build
exit 0.

### Fresh single-Wrangler re-verify (2026-07-25, pre–Prompt 5)

Earlier browser checks against a long-lived `127.0.0.1:8787` instance were
**not** trusted: `/api/health` served the SPA landing HTML (asset fallback) and
WebSocket leave behavior matched the pre-fix bug — consistent with a stale or
conflicted local Worker, not with checked-in `main`.

Ops: stopped all `wrangler`/`workerd` processes, cleared `.wrangler/state`,
started **exactly one** `npm run dev`.

```text
GET http://127.0.0.1:8787/api/health
→ {"ok":true,"service":"loomline","phase":"rooms-presence"}
One workerd listener on :8787 (no second app server on that port).
```

Manual leave on that instance: room `fd850e7e`, two tabs → presence = 2;
close tab B → tab A immediately and after 1.6s shows only `Artist-6829 (you)`.

Note: local `SQLITE_BUSY` remains classified as concurrent Wrangler contention
on DO SQLite state (see `ISSUES.md` I3), not an app-code defect.

### Deferred follow-ups (not blockers)

- Focused `LocalDrawingController` pointer-up/clear/layer tests
- Markdown trailing-space cleanup before final audit
- Do not commit `.cursor/`
