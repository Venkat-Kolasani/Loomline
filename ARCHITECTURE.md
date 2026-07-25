# Architecture

Status legend: **Implemented** vs **Planned**.

## Overview

Loomline is a room-scoped collaborative drawing app. Clients render locally with
the Canvas 2D API. Presence (and later drawing sync) goes through a Cloudflare
Worker that routes each room id to one Durable Object.

```mermaid
flowchart LR
  L["Landing /r create"] --> C1["Client A /r/id"]
  C1 -->|"wss /ws?room=id"| W["Cloudflare Worker"]
  C2["Client B /r/id"] -->|"wss /ws?room=id"| W
  W -->|"idFromName(roomId)"| R["RoomDurableObject"]
  R --> P["Presence via WS attachments"]
  R --> S["Planned: SQLite committed ops"]
  W -->|"ASSETS"| A["Static SPA"]
```

## Why `idFromName(roomId)` is safe isolation

Cloudflare maps the string passed to `idFromName` through an internal hash to a
**unique Durable Object id**. The Worker never shares one DO across different
room id strings: `idFromName("aaaa1111")` and `idFromName("bbbb2222")` yield
different ids and therefore different SQLite stores and WebSocket sets.

We do **not** use `newUniqueId()` for rooms, because clients must reconnect to
the same room by sharing the human room id in the URL.

Verified in `test/rooms.test.ts`: two room ids write distinct storage marks with
zero crossover.

## Implemented

| Piece | Role |
| --- | --- |
| Landing (`/`) | Create random 8-char room id or join by id → `/r/:roomId` |
| Room client | Presence list + connection status; local drawing only |
| Canvas layers | `committed-canvas` + `live-canvas`; dirty rAF paint |
| Local drawing | Brush/eraser/colour/width/clear (not networked) |
| Worker | `/api/health`, `/ws?room=`, static assets |
| `RoomDurableObject` | Hibernatable WebSocket join + presence broadcast |
| Shared (`shared/room.ts`) | Room id helpers + protocol types |

### Request path (current)

1. `/` and `/r/:roomId` served as SPA assets.
2. Client opens `ws(s)://origin/ws?room=<id>` and sends `join`.
3. Worker validates room id → `env.ROOM.idFromName(roomId)` → DO upgrade.
4. DO assigns participant id/colour, stores small attachment metadata, broadcasts
   `presence` on join/leave.

### Rendering layers (current)

1. **committed-canvas** — finished **local** strokes (later: server-sequenced ops).
2. **live-canvas** — in-progress local stroke preview.

## Planned

### Drawing sync / persistence

- Live stroke fan-out and durable `operation:committed` with SQLite
- Global tombstone undo/redo
- Snapshot/replay on reconnect

### Scaling path (planned, not claimed)

- One DO coordinator per room; measure before claiming multi-region numbers

## Explicit runtime note

This is **not** a Node.js server. The Worker runs on Cloudflare's edge JavaScript
runtime. Rationale: [DECISIONS.md](./DECISIONS.md).
