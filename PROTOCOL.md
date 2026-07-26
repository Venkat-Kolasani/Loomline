# Protocol

**Protocol version:** `3` (`2` → `3`: coordinates are normalized, see
[Coordinate space](#coordinate-space))
**Status:** presence, live strokes, durable stroke/clear ops, global undo/redo, reconnect
recovery, input-boundary hardening, and **developer diagnostics / load baseline**
are implemented.

## Transport

- Browser native `WebSocket` to the same origin Worker
- Path: `/ws?room=<roomId>`
- Production origin: `https://loomline.kolasanivenkat2.workers.dev`
  (`wss://loomline.kolasanivenkat2.workers.dev/ws?room=<roomId>`)
- Worker validates `roomId`, then forwards the upgrade to
  `env.ROOM.get(env.ROOM.idFromName(roomId))`

All JSON messages include:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Message discriminant |
| `protocolVersion` | number | Must be `3` |
| `roomId` | string | Must match the socket room |

## Coordinate space

Every `x` / `y` in this protocol — stroke points, the optional `stroke:end`
point, and `cursor` — is **normalized**: `x` is a fraction of the sender's
canvas width and `y` a fraction of its height, so `{ "x": 0.5, "y": 0.5 }` is
the centre of any canvas at any size or orientation. Receivers multiply by the
canvas box that is current when they paint, which is what lets a persisted
operation log replay correctly after a resize, a rotation, or a rejoin from a
differently sized window.

Values slightly outside `0`–`1` are legal (pointer capture reports samples past
the canvas edge) and are validated only as finite numbers. `width` is **not**
normalized: it stays in CSS pixels so ink keeps a consistent physical weight.

Version `2` used the sender's raw CSS pixels. The version bump exists so a
stale client cannot mix the two spaces in one room; it is rejected with
`protocol_mismatch`. Operations persisted by version `2` builds still hold
pixel values and are not migrated.

Invalid client messages return a typed `error` and do not crash the room.
Shape validation lives in `shared/protocol.ts` (`parseClientMessage`). Frame
size and per-participant rate limits are enforced in `RoomDurableObject`
(`shared/limits.ts`) before handlers mutate room state.

## Implemented messages

| Message | Direction | Meaning |
| --- | --- | --- |
| `join` | client → server | Enter the room with optional `displayName` |
| `welcome` | server → client | Assigned participant id, colour, display name |
| `sync_state` | server → client | Visible committed ops + `sequenceHead` + undo/redo flags after join/reconnect |
| `presence` | server → all | Full participant list for the room |
| `stroke:start` | client → server | Begin a provisional stroke |
| `stroke:points` | client → server | Batched additional points (≤ 64 per message) |
| `stroke:end` | client → server | Finish provisional stroke; server may commit one op |
| `stroke:live` | server → peers | Fan-out of start / points / end for live overlay |
| `canvas:clear` | client → server | Append one room-global durable clear operation |
| `operation:committed` | server → **all** | Durable op with authoritative increasing `sequence` |
| `history:undo` | client → server | Tombstone latest **visible** completed op |
| `history:redo` | client → server | Remove newest redoable tombstone |
| `history:changed` | server → **all** | Visible op set after undo/redo; clients rebuild |
| `cursor` | client → server → peers | Ephemeral pointer position |
| `ping` | client → server | RTT probe with `clientTime` (diagnostics) |
| `pong` | server → client | Echoes `clientTime` + `serverTime` |
| `error` | server → client | Recoverable typed failure (`stroke_expired`, …) |

### Ordering contract (implemented)

1. `stroke:end` may produce a durable `kind: "stroke"` operation (only if the
   stroke was live on the server with at least one point). `canvas:clear`
   produces a durable `kind: "clear"` operation.
   An optional final point is filtered/appended before commit so pointer-up
   geometry is not lost.
2. The room Durable Object assigns the next strictly increasing `sequence`,
   stores **one SQLite row** for the operation, and broadcasts
   `operation:committed` to every socket in the room (including the author).
3. Clients apply ops by sequence and ignore duplicate sequences.
4. Overlapping strokes are valid; later sequence paints later (stable layering).
5. Mid-stroke disconnect discards the live stroke — it never becomes durable.
6. Undo/redo never DELETE or UPDATE rows in `operations`.
7. Replay is deterministic: a visible clear resets prior pixels at its sequence;
   later visible strokes paint normally.

### Reconnect contract (implemented)

1. Unexpected WebSocket close schedules exponential reconnect with jitter
   (base 500 ms, cap 15 s). Intentional leave does not reconnect.
2. UI states: Connecting… → Connected; on drop → Reconnecting… (try N).
3. Each successful reconnect sends `join` again and receives a full visible
   `sync_state` snapshot (not a delta). Client replaces the committed store.
4. `CommittedOperationStore` remembers applied sequences and ignores duplicate
   `operation:committed` events (late fan-out / overlapping reconnect).
5. Ephemeral live ink and awaiting-commit local strokes are cleared on reconnect
   schedule; only durable ops are restored from `sync_state`.
6. Participant id and colour are reassigned on each join (no sticky identity in
   this slice). Loomline's landing page remembers the chosen display name only
   in that browser and sends it again on reconnect; the Durable Object still
   trims/caps the value and falls back to `Artist-<id>` when it is blank.

### Live stroke stall contract (implemented)

1. Provisional **points** are in-memory only (`liveStrokes` map).
2. Minimal **expiry metadata** is written to SQLite `live_stroke_expiry`
   (participant id, stroke id, room id, `expires_at`) on start/points; removed
   on end/close/expire. Points are never stored there.
3. After **30 s** without activity, the DO alarm reads expired rows, broadcasts
   `stroke:live` `phase=end` to peers, and sends `error` `stroke_expired` to the
   author if still connected — even if hibernation wiped the in-memory map.
4. Socket close/error abandons that participant’s live strokes the same way
   (peer overlay cleared; no commit).
5. After Durable Object hibernation, the live map is empty; constructor
   re-ensures schemas and re-arms the alarm from remaining expiry rows.

### History contract (implemented)

1. Undo hides the latest visible completed operation (highest sequence not
   currently tombstoned). Live strokes are not in the log and cannot be undone.
2. Undo pushes that sequence onto a durable redo stack and into `history_hidden`.
3. Redo pops the top of the redo stack and removes that sequence from
   `history_hidden`.
4. A newly committed operation **clears the redo stack** but leaves existing
   tombstones in `history_hidden` (undone ops stay gone; redo is invalidated).
5. `sync_state` and `history:changed` send only **visible** operations.
   `sequenceHead` is still `MAX(sequence)` over the full append-only log.
6. Any joined participant may undo/redo globally; author identity does not matter.
7. A clear is history like any completed operation: undo makes earlier strokes
   reappear; redo reapplies the clear.
8. Clear does not abandon active strokes. A stroke ending after clear receives a
   later sequence and remains visible.

### Stroke batching contract

Clients must batch `stroke:points` at most once per `requestAnimationFrame`.
Local pixels still update immediately on each accepted pointer sample.
Each flush is chunked to at most 64 points. Cursor messages are suppressed while
a stroke is active so the normal drawing path leaves rate-limit headroom for
point batches and `stroke:end`.

Clients must not send `stroke:points` / `stroke:end` for a `strokeId` unless
`stroke:start` was successfully sent while joined (`LiveStrokeTransport`).

### sync_state example

```json
{
  "type": "sync_state",
  "protocolVersion": 3,
  "roomId": "abcd1234",
  "sequenceHead": 2,
  "operations": [
    {
      "sequence": 1,
      "opId": "…",
      "participantId": "…",
      "kind": "stroke",
      "strokeId": "…",
      "tool": "brush",
      "color": "#0f6a5a",
      "width": 4,
      "points": [{ "x": 0.1, "y": 0.1 }, { "x": 0.2, "y": 0.25 }],
      "createdAt": 1720000000000
    }
  ],
  "canUndo": true,
  "canRedo": false
}
```

### history:changed example

```json
{
  "type": "history:changed",
  "protocolVersion": 3,
  "roomId": "abcd1234",
  "sequenceHead": 2,
  "operations": [
    {
      "sequence": 1,
      "opId": "…",
      "participantId": "…",
      "kind": "stroke",
      "strokeId": "stroke-a",
      "tool": "brush",
      "color": "#0f6a5a",
      "width": 4,
      "points": [{ "x": 0.1, "y": 0.1 }],
      "createdAt": 1720000000000
    }
  ],
  "canUndo": true,
  "canRedo": true
}
```

### operation:committed example

```json
{
  "type": "operation:committed",
  "protocolVersion": 3,
  "roomId": "abcd1234",
  "operation": {
    "sequence": 3,
    "opId": "…",
    "participantId": "…",
    "kind": "stroke",
    "strokeId": "…",
    "tool": "eraser",
    "color": "#334155",
    "width": 12,
    "points": [{ "x": 0.4, "y": 0.4 }, { "x": 0.6, "y": 0.6 }],
    "createdAt": 1720000000500
  }
}
```

### canvas:clear and committed clear example

```json
{
  "type": "canvas:clear",
  "protocolVersion": 3,
  "roomId": "abcd1234"
}
```

```json
{
  "type": "operation:committed",
  "protocolVersion": 3,
  "roomId": "abcd1234",
  "operation": {
    "kind": "clear",
    "sequence": 4,
    "opId": "…",
    "participantId": "…",
    "createdAt": 1720000000600
  }
}
```

## Planned message catalogue

Delta-by-`lastSequence` join remains a future optimization; reconnect already
restores via full visible `sync_state`.

## Payload limits (current)

| Field | Limit |
| --- | --- |
| Raw text frame | ≤ `16_384` **UTF-8 bytes** (`MAX_CLIENT_MESSAGE_BYTES`), measured with `TextEncoder` before `JSON.parse` (not JS string `.length`) |
| `strokeId` | 1–64 characters |
| `points` per `stroke:points` | 1–64 (`MAX_POINTS_PER_MESSAGE`) |
| `width` | integer 1–32 |
| `color` | `#RRGGBB` |
| `displayName` | optional; server trims/caps at 24 characters and falls back when blank |
| Client abuse frames / participant / 1s | ≤ `120` (`MAX_MESSAGES_PER_WINDOW`) — binary / oversized / malformed / parse failures only |

Valid join / stroke / cursor / history / `ping` frames **do not** consume the
rate budget and never return `rate_limited`. The budget exists only so a
hostile flood of garbage frames gets a typed error instead of unbounded work
before rejection. History is **not** debounced — each accepted `history:undo`
/ `history:redo` runs to completion under Durable Object serialization.
Clients still send `ping` only while the Metrics dock is expanded (cheaper RTT
sampling; not required for rate-limit safety).

### Typed boundary errors (non-exhaustive)

| `code` | When |
| --- | --- |
| `invalid_json` | Non-JSON text frame |
| `payload_too_large` | Frame longer than `MAX_CLIENT_MESSAGE_BYTES` UTF-8 bytes |
| `unsupported_type` | Unknown `type` |
| `protocol_mismatch` | Wrong `protocolVersion` |
| `invalid_payload` | Bad shape / binary frames / field constraints |
| `rate_limited` | Abuse-frame budget exceeded (valid protocol traffic exempt) |
| `not_joined` / `room_mismatch` | Join / room binding failures |

## HTTP endpoints

| Endpoint | Transport | Behavior |
| --- | --- | --- |
| `GET /api/health` | HTTP | `{ ok, service: "loomline", phase: "observability" }` |
| `GET /api/room-metrics?room=` | HTTP | Durable-head snapshot (`sequenceHead`, `operationCount`, live counts) for load scripts |
| `GET /ws?room=` | WebSocket | Room join + live + committed sync + history |
| Static assets | HTTP via `ASSETS` | Landing + `/r/:roomId` SPA |
