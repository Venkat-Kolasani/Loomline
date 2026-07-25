# Protocol

**Protocol version (planned):** `1`  
**Status:** schemas below are **planned**. No WebSocket messages are accepted or
emitted yet.

## Transport (planned)

- Browser native `WebSocket` to the same origin Worker
- Expected path shape: `/ws?room=<roomId>`
- All messages are JSON objects with at least:

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Message discriminant |
| `protocolVersion` | number | Must match server-supported version |
| `roomId` | string | Must match the connected room |

Invalid messages return a typed `error` response and must not crash the room.

## Planned message catalogue

| Message | Direction | Meaning |
| --- | --- | --- |
| `join` | client → server | Enter a room; identify participant |
| `snapshot` | server → client | Latest committed visible state + sequence cursor |
| `stroke:start` | client → server | Begin a provisional stroke (`strokeId` client-generated) |
| `stroke:points` | client → server | Batched points for an in-progress stroke |
| `stroke:end` | client → server | Finish stroke; request durable commit |
| `stroke:live` | server → peers | Fan-out in-progress overlay geometry |
| `operation:committed` | server → all | Durable op with authoritative increasing `sequence` |
| `history:undo` / `history:redo` | client → server | Request global history transition |
| `history:changed` | server → all | Visible set / version changed; rebuild committed layer |
| `cursor` / `presence` | both | Ephemeral collaboration metadata |
| `error` | server → client | Recoverable typed failure |

## Ordering and idempotency (planned)

1. Only `stroke:end` may produce a durable operation.
2. The room Durable Object assigns the next strictly increasing `sequence`.
3. Clients apply committed ops in sequence order; never apply an already-seen sequence twice.
4. Overlapping strokes are valid composition; stacking follows server sequence.
5. Undo/redo are server-owned tombstone transitions over completed ops only.
6. A newly committed operation clears the redo branch.

## Validation (planned)

Server boundary checks include protocol version, room id match, payload shape,
point limits, and rate/abuse limits. Exact error codes will be listed here when
implemented.

## Examples (planned; not live)

```json
{
  "type": "stroke:end",
  "protocolVersion": 1,
  "roomId": "abc123",
  "strokeId": "c-9f3a",
  "tool": "brush",
  "color": "#0f6a5a",
  "width": 4,
  "points": [{ "x": 10, "y": 20 }, { "x": 14, "y": 28 }]
}
```

```json
{
  "type": "operation:committed",
  "protocolVersion": 1,
  "roomId": "abc123",
  "sequence": 42,
  "operation": {
    "kind": "stroke",
    "strokeId": "c-9f3a",
    "tool": "brush",
    "color": "#0f6a5a",
    "width": 4,
    "points": [{ "x": 10, "y": 20 }, { "x": 14, "y": 28 }]
  }
}
```

## Implemented today

| Endpoint | Transport | Behavior |
| --- | --- | --- |
| `GET /api/health` | HTTP | JSON `{ ok, service: "loomline", phase }` |
| Static assets | HTTP via `ASSETS` | Built Vite client |
