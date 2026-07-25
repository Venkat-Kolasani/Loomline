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
- [ ] Live strokes sync (not in this slice)
- [ ] Global undo/redo matches on both
- [ ] Refresh restores committed canvas
- [ ] Malformed WS payload returns typed error; room survives

### Touch / mobile

- [x] Touch drawing path exercised via PointerEvent emulation (earlier slice)
- [ ] Controls usable on narrow viewport (spot-check later)

### Deployed smoke

- [ ] Fresh session on live URL loads
- [ ] Two clients against deployed origin

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

### Deferred follow-ups (not blockers)

- Focused `LocalDrawingController` pointer-up/clear/layer tests
- Markdown trailing-space cleanup before final audit
- Do not commit `.cursor/`
