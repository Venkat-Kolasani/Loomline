# Protocol

**Protocol version:** `1`  
**Status:** presence `join` / `welcome` / `presence` / `error` are **implemented**.
Stroke and history messages remain planned.

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

## Implemented messages

| Message | Direction | Meaning |
| --- | --- | --- |
| `join` | client → server | Enter the room (optional `displayName`) |
| `welcome` | server → client | Assigned participant id, colour, display name |
| `presence` | server → all | Full participant list for the room |
| `error` | server → client | Recoverable typed failure |

### Join example

```json
{
  "type": "join",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "displayName": "Venkat"
}
```

### Welcome example

```json
{
  "type": "welcome",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "participant": {
    "id": "…uuid…",
    "displayName": "Venkat",
    "color": "#0f6a5a"
  }
}
```

### Presence example

```json
{
  "type": "presence",
  "protocolVersion": 1,
  "roomId": "abcd1234",
  "participants": [
    { "id": "…", "displayName": "Venkat", "color": "#0f6a5a" }
  ]
}
```

## Planned message catalogue

| Message | Direction | Meaning |
| --- | --- | --- |
| `snapshot` | server → client | Latest committed visible state + sequence cursor |
| `stroke:start` / `stroke:points` / `stroke:end` | client → server | Live stroke stream |
| `stroke:live` | server → peers | Fan-out in-progress geometry |
| `operation:committed` | server → all | Durable op with authoritative `sequence` |
| `history:undo` / `history:redo` | client → server | Global history transition |
| `history:changed` | server → all | Rebuild committed layer |
| `cursor` | both | Ephemeral cursor positions |

## Ordering and idempotency (planned for drawing ops)

1. Only `stroke:end` may produce a durable operation.
2. The room Durable Object assigns the next strictly increasing `sequence`.
3. Clients never apply an already-seen sequence twice.
4. Overlapping strokes stack by server sequence.
5. Undo/redo are server-owned tombstones over completed ops only.

## HTTP endpoints

| Endpoint | Transport | Behavior |
| --- | --- | --- |
| `GET /api/health` | HTTP | `{ ok, service: "loomline", phase }` |
| `GET /ws?room=` | WebSocket | Room presence join |
| Static assets | HTTP via `ASSETS` | Landing + `/r/:roomId` SPA |
