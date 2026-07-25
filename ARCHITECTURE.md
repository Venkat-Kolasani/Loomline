# Architecture

Status legend: **Implemented** vs **Planned**.

## Overview

RelayCanvas is a room-scoped collaborative drawing app. Clients render locally
with the Canvas 2D API and synchronize through a Cloudflare Worker that routes
each room to one Durable Object.

```mermaid
flowchart LR
  C1["Client A"] -->|"planned: wss /ws?room=id"| W["Cloudflare Worker"]
  C2["Client B"] -->|"planned: wss /ws?room=id"| W
  W -->|"planned: room id routing"| R["RoomDurableObject"]
  R --> S["Planned: SQLite committed ops"]
  W -->|"implemented: ASSETS"| A["Static client build"]
```

## Implemented in this slice

| Piece | Role |
| --- | --- |
| Vite client (`client/`) | Vanilla TypeScript shell; no Canvas yet |
| Worker (`worker/index.ts`) | Serves `/api/health` and static assets via `env.ASSETS` |
| `RoomDurableObject` (`worker/room.ts`) | Exported DO class + Wrangler binding/migration skeleton |
| Wrangler assets | `dist/client` uploaded/served with the Worker on one origin |

### Request path (current)

1. Browser requests a path on the Worker origin.
2. `/api/health` returns a JSON scaffold status.
3. All other paths are delegated to `env.ASSETS.fetch(request)` (built Vite output).
4. Durable Object stubs exist in `env.ROOM` but are not routed from HTTP/WebSocket yet.

## Planned system design

### Rendering layers (planned)

1. **Committed layer** — deterministic replay of visible server-confirmed operations in sequence order.
2. **Live overlay** — ephemeral local/remote in-progress strokes; redrawn only when live state changes.

Invariant: local pixels appear before the first network round trip. There is no permanent `requestAnimationFrame` loop; layers render when dirty.

### Room lifecycle (planned)

1. Landing page creates/opens a short room id URL.
2. Worker upgrades WebSocket and routes by room id to `env.ROOM.idFromName(roomId)`.
3. DO accepts the socket, sends a snapshot, then streams live + committed events.
4. Idle rooms may hibernate; constructor/reload restores durable state from SQLite.
5. Different room ids map to different DO instances — no shared history.

### Persistence (planned)

- Persist only completed strokes as operation records (not one row per pointer point).
- Store room metadata and undo tombstones in Durable Object SQLite.
- Live strokes remain ephemeral and may expire safely.

### Reconnect / hibernation (planned)

- Client reconnects with last-seen sequence.
- Server returns snapshot/replay from durable state.
- Client ignores already-applied sequences.
- Hibernation is treated as real: in-memory-only state is never assumed to survive.

### Scaling path (planned, not claimed)

- Horizontal fan-out is per room (one DO coordinator per room).
- Large histories may later use optional Canvas checkpoints (stretch).
- Cross-region latency will be measured and documented, not promised up front.

## Explicit runtime note

This is **not** a Node.js server. The Worker runs on Cloudflare's edge JavaScript
runtime. Native WebSockets and TypeScript remain web-standard; the coordinator is
a Durable Object instead of a long-lived Node `ws` process. Rationale:
[DECISIONS.md](./DECISIONS.md).
