# Protocol

**Protocol version:** `1`  
**Status:** presence + ephemeral live strokes / cursors **implemented**.
Durable `operation:committed`, snapshots, and undo/redo remain planned.

## Transport

- Browser native `WebSocket` to the same origin Worker
- Path: `/ws?room=<roomId>`
- Worker validates `roomId`, then forwards the upgrade to
  `env.ROOM.get(env.ROOM.idFromName(roomId))`

All JSON messages include:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Message discriminant |
| `protocolVersion` | number | Must be `1` |
| `roomId` | string | Must match the socket room |

Invalid client messages return a typed `error` and do not crash the room.
Validation lives in `shared/protocol.ts` (`parseClientMessage`).

## Implemented messages

| Message | Direction | Meaning |
| --- | --- | --- |
| `join` | client → server | Enter the room (optional `displayName`) |
| `welcome` | server → client | Assigned participant id, colour, display name |
| `presence` | server → all | Full participant list for the room |
| `stroke:start` | client → server | Begin a provisional stroke (`strokeId`, tool, colour, width, first point) |
| `stroke:points` | client → server | Batched additional points (≤ 64 per message) |
| `stroke:end` | client → server | Finish the provisional stroke (optional final point) |
| `stroke:live` | server → peers | Fan-out of start / points / end for live overlay only |
| `cursor` | client → server → peers | Ephemeral pointer position |
| `error` | server → client | Recoverable typed failure |

### Ordering note (this slice)

Live strokes are **ephemeral**. `stroke:end` clears server-side live tracking and
broadcasts `phase: "end"`. It does **not** assign a sequence number or write
SQLite. Durable ordering arrives in the next history slice.

Clients may retain finished remote strokes locally as provisional ink so peers
still see completed shapes until `operation:committed` exists. That retention is
not authoritative.

### Stroke batching contract

Clients must batch `stroke:points` at most once per `requestAnimationFrame`.
Local pixels still update immediately on each accepted pointer sample.

### Join example

```json
{
  "type": "join",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "displayName": "Venkat"
}
```

### stroke:start example

```json
{
  "type": "stroke:start",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "strokeId": "…uuid…",
  "tool": "brush",
  "color": "#0f6a5a",
  "width": 4,
  "point": { "x": 120.5, "y": 80 }
}
```

### stroke:live (points) example

```json
{
  "type": "stroke:live",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "participantId": "…uuid…",
  "strokeId": "…uuid…",
  "phase": "points",
  "points": [
    { "x": 122, "y": 84 },
    { "x": 130, "y": 90 }
  ]
}
```

### cursor example (server → peer)

```json
{
  "type": "cursor",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "participantId": "…uuid…",
  "x": 210,
  "y": 140
}
```

### error example

```json
{
  "type": "error",
  "protocolVersion": 1,
  "code": "invalid_payload",
  "message": "color must be a #RRGGBB hex string."
}
```

## Planned message catalogue

| Message | Direction | Meaning |
| --- | --- | --- |
| `snapshot` / `sync_state` | server → client | Latest committed visible state + sequence cursor |
| `operation:committed` | server → all | Durable op with authoritative `sequence` |
| `history:undo` / `history:redo` | client → server | Global history transition |
| `history:changed` | server → all | Rebuild committed layer |

## Ordering and idempotency (planned for durable ops)

1. Only `stroke:end` may produce a durable operation (next slice).
2. The room Durable Object assigns the next strictly increasing `sequence`.
3. Clients never apply an already-seen sequence twice.
4. Overlapping strokes stack by server sequence.
5. Undo/redo are server-owned tombstones over completed ops only.

## Payload limits (current)

| Field | Limit |
| --- | --- |
| `strokeId` | 1–64 characters |
| `points` per `stroke:points` | 1–64 |
| `width` | integer 1–32 |
| `color` | `#RRGGBB` |
| `displayName` | trimmed, max 24 chars |

## HTTP endpoints

| Endpoint | Transport | Behavior |
| --- | --- | --- |
| `GET /api/health` | HTTP | `{ ok, service: "loomline", phase: "live-strokes" }` |
| `GET /ws?room=` | WebSocket | Room join + live stroke / cursor fan-out |
| Static assets | HTTP via `ASSETS` | Landing + `/r/:roomId` SPA |
