# AI usage

AI assistance is allowed for this assignment. No retained code should be opaque
to the author.

## Project name

Product name is **Loomline** (repository and Worker name match).

## Scaffold (`chore(scaffold): initialize edge application`)

### Assisted by AI

- Project layout for Vite client + Wrangler Worker + Durable Object skeleton
- Initial `package.json` scripts and Vitest Workers pool wiring
- First drafts of README / ARCHITECTURE / PROTOCOL / DECISIONS / TESTING docs
- Health endpoint and minimal DO skeleton implementation

### Manually reviewed / owned by the author

- Confirmed stack matches `AGENTS.md` / `PROJECT_BLUEPRINT.md` (no React,
  Socket.io, Canvas library, or room behavior in the scaffold)
- Confirmed Workers vs Node.js trade-off is stated honestly in docs
- Ran install, typecheck, test, build, and local Worker start; recorded results
  in `TESTING.md`

## Rooms + presence (`feat(rooms): add isolated room routing`)

### Assisted by AI

- Room id helpers, Worker `/ws` routing, Durable Object presence, landing UI

### Manually reviewed / owned by the author

- Explains `idFromName` isolation and presence attachment metadata
- Verified automated isolation test and two-room browser presence

## Presence leave fix (`fix(presence): exclude departing socket`)

### Assisted by AI

- Exclude departing WebSocket/participant id from presence projection on
  close/error; two-client integration tests; test-only simulate-error route

### Manually reviewed / owned by the author

- Confirms `getWebSockets()` still lists the closing socket during
  `webSocketClose` / `webSocketError`
- Owns the exclusion contract and test evidence in `TESTING.md`

## Client room reset (`fix(rooms): reset client state on room reuse`)

### Assisted by AI

- Clear self/presence/ink on `enterRoom` / landing; ignore superseded socket events

### Manually reviewed / owned by the author

- Understands why old close handlers must not overwrite a new connection status

## Live strokes (`feat(realtime): broadcast live stroke batches`)

### Assisted by AI

- `shared/protocol.ts` validation, DO live fan-out, client rAF batcher, remote
  live overlay + cursor layer, protocol/live integration tests, docs updates

### Manually reviewed / owned by the author

- Explains why local paint is immediate while network points coalesce per rAF
- Confirms `stroke:end` does **not** persist or sequence in this slice
- Owns two-browser mid-stroke proof and typed-error recovery evidence

## Connecting race gate (`fix(realtime): gate strokes until start accepted`)

### Assisted by AI

- `LiveStrokeTransport` accepted-start set; regression test for Connecting… race

### Manually reviewed / owned by the author

- Explains why points must not flush after welcome for a stroke that never started
  on the wire

## Durable ops (`feat(history): add durable ordered room operations`)

### Assisted by AI

- SQLite `operations` helpers, DO commit on `stroke:end`, `sync_state`, client
  `CommittedOperationStore`, history integration tests, docs updates

### Manually reviewed / owned by the author

- Explains sequence assignment, one-row-per-stroke persistence, and why
  mid-stroke close must not commit
- Owns overlap/join/abandon test evidence

## Undo/redo (`feat(history): add global tombstone-based undo redo`)

### Assisted by AI

- `worker/history.ts` tombstone helpers, DO undo/redo handlers, protocol
  `history:*` messages, client button wiring, history tests, docs

### Manually reviewed / owned by the author

- Explains why redo clears on new commit while hidden ops stay hidden
- Owns global-versus-per-user decision and two-browser undo proof

## Reconnect (`feat(resilience): recover rooms after reconnect`)

### Assisted by AI

- Client reconnect backoff + RoomSocket auto-rejoin, applied-sequence
  suppression, DO stall alarm / abandon broadcast, reconnect tests, docs

### Manually reviewed / owned by the author

- Explains full snapshot vs last-seq delta with tombstones
- Owns two-browser refresh reconnect proof and 30s stall rule

