# Protocol

**Protocol version:** `1`  
**Status:** presence, live strokes/cursors, and **durable ordered operations**
are implemented. Undo/redo remain planned.

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
| `sync_state` | server → client | Snapshot/replay of committed ops + `sequenceHead` after join |
| `presence` | server → all | Full participant list for the room |
| `stroke:start` | client → server | Begin a provisional stroke |
| `stroke:points` | client → server | Batched additional points (≤ 64 per message) |
| `stroke:end` | client → server | Finish provisional stroke; server may commit one op |
| `stroke:live` | server → peers | Fan-out of start / points / end for live overlay |
| `operation:committed` | server → **all** | Durable op with authoritative increasing `sequence` |
| `cursor` | client → server → peers | Ephemeral pointer position |
| `error` | server → client | Recoverable typed failure |

### Ordering contract (implemented)

1. Only `stroke:end` may produce a durable operation (and only if the stroke was
   live on the server with at least one point).
2. The room Durable Object assigns the next strictly increasing `sequence`,
   stores **one SQLite row** for the whole stroke, and broadcasts
   `operation:committed` to every socket in the room (including the author).
3. Clients apply ops by sequence and ignore duplicate sequences.
4. Overlapping strokes are valid; later sequence paints later (stable layering).
5. Mid-stroke disconnect discards the live stroke — it never becomes durable.
6. Undo/redo are not implemented in this slice.

### Stroke batching contract

Clients must batch `stroke:points` at most once per `requestAnimationFrame`.
Local pixels still update immediately on each accepted pointer sample.

Clients must not send `stroke:points` / `stroke:end` for a `strokeId` unless
`stroke:start` was successfully sent while joined (`LiveStrokeTransport`).

### sync_state example

```json
{
  "type": "sync_state",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "sequenceHead": 2,
  "operations": [
    {
      "sequence": 1,
      "opId": "…",
      "participantId": "…",
      "strokeId": "…",
      "tool": "brush",
      "color": "#0f6a5a",
      "width": 4,
      "points": [{ "x": 10, "y": 10 }, { "x": 20, "y": 25 }],
      "createdAt": 1720000000000
    }
  ]
}
```

### operation:committed example

```json
{
  "type": "operation:committed",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "operation": {
    "sequence": 3,
    "opId": "…",
    "participantId": "…",
    "strokeId": "…",
    "tool": "eraser",
    "color": "#334155",
    "width": 12,
    "points": [{ "x": 40, "y": 40 }, { "x": 60, "y": 60 }],
    "createdAt": 1720000000500
  }
}
```

## Planned message catalogue

| Message | Direction | Meaning |
| --- | --- | --- |
| `history:undo` / `history:redo` | client → server | Global history transition |
| `history:changed` | server → all | Rebuild committed layer after undo/redo |

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
| `GET /api/health` | HTTP | `{ ok, service: "loomline", phase: "durable-ops" }` |
| `GET /ws?room=` | WebSocket | Room join + live + committed sync |
| Static assets | HTTP via `ASSETS` | Landing + `/r/:roomId` SPA |
