# Loomline

Real-time collaborative drawing canvas for the Flam Frontend R&D assignment.

**Live URL:** _not deployed yet_  
**Status:** global tombstone undo/redo + durable ordered operations

This repository intentionally uses **Cloudflare Workers + Durable Objects** (edge
JavaScript runtime), not a Node.js process. See [DECISIONS.md](./DECISIONS.md).

## What works now (implemented)

- Vite vanilla TypeScript client shell
- Landing page: create/join shareable `/r/<roomId>` links
- Worker routes `/ws?room=` to one Durable Object per room via `idFromName`
- Presence: join/leave list with deterministic participant colours
- Live stroke fan-out (`stroke:start` / `points` / `end` → `stroke:live`)
- Durable `operation:committed` with SQLite + strictly increasing sequence
- Join `sync_state` snapshot/replay of the **visible** committed log
- Global server-owned undo/redo via tombstones (`history:undo` / `redo` /
  `history:changed`); append-only op log is never mutated
- Remote cursors (ephemeral)
- rAF-batched outgoing points; immediate local drawing
- Two stacked canvas layers with brush/eraser/colour/width/clear
- Dirty-layer paint API (no permanent render loop)
- Scripts: `dev`, `dev:client`, `typecheck`, `test`, `build`, `deploy`
- Vitest: isolation, protocol, live strokes, sequence/join/overlap/history undo

## What is planned (not implemented)

- Reconnect backoff / last-sequence resume UX (join already sends sync_state)
- Deployed demo URL

## Quick start

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Then open `http://127.0.0.1:8787/`, create a room, and open the same room URL in
a second browser profile. Draw in one tab — the peer should see the stroke
**while it is still in progress**.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Build client assets, then start local Worker (`wrangler dev`) |
| `npm run dev:client` | Vite-only client HMR (no Worker / `/api/health`) |
| `npm run typecheck` | TypeScript checks for app + tests |
| `npm run test` | Vitest with Cloudflare Workers pool |
| `npm run build` | Production client build into `dist/client` |
| `npm run deploy` | Build + `wrangler deploy` (requires Cloudflare auth) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from Wrangler config |

## Multi-user testing

1. Run `npm run dev` and open `http://127.0.0.1:8787/`.
2. Click **Create room** and copy the room link.
3. Open the same link in a second browser/profile — both presence lists should
   show two participants.
4. Draw slowly in client A — client B must show the stroke **before** A lifts
   the pointer (live overlay).
5. After A ends the stroke, both clients keep it via `operation:committed`.
6. Open a third client on the same room — it receives `sync_state` with the same
   committed strokes.
7. Open a **different** room id — presence and strokes must not cross rooms.

## Supported browsers

_Not claimed yet._ Target: current Chrome, Firefox, and Safari once drawing sync
and mobile passes are verified.

## Known limitations

- Clear is local-only (does not clear peers’ committed ops or history)
- Live in-progress strokes are not undoable (only completed ops)
- No exponential reconnect UI yet (fresh join still gets `sync_state`)
- Production deploy not run yet
- Very long strokes are stored as one JSON blob (no checkpoint yet)

## Time spent

Tracked per commit; update at submission freeze.

## AI use

AI assisted scaffolding and canvas-shell work. Every retained line is intended to
be explainable by the author. Details: [AI_USAGE.md](./AI_USAGE.md).

## Assignment Compliance Checklist

Leave unchecked until implemented **and** verified with evidence.

### Frontend features

- [x] Drawing tools: brush, eraser, colours, stroke width
- [x] Real-time sync: peers see in-progress strokes, not only finished strokes
- [x] User indicators: remote cursor / drawing position
- [x] Conflict resolution: overlapping strokes remain stable via server sequence
- [x] Global undo/redo across all users
- [x] User management: online presence and deterministic participant colours

### Technical stack

- [x] Frontend: vanilla TypeScript + HTML5 Canvas (no framework, no Canvas library)
- [x] Backend realtime: native browser WebSocket (no Socket.io)
- [x] Backend hosting: Cloudflare Worker + one Durable Object per room (documented trade-off vs Node.js)
- [x] Persistence: Durable Object SQLite for committed operations

### Technical challenges

- [x] Efficient Canvas path rendering and dirty-layer redraws
- [x] Pointer batching (at most one network batch per animation frame)
- [x] Layered committed vs live overlay model
- [x] Versioned, validated WebSocket protocol
- [x] Server-authoritative operation ordering
- [x] Global undo/redo without mutating the durable operation log incorrectly
- [ ] Reconnect / snapshot recovery without duplicate sequence application
- [x] Recoverable typed errors for invalid client messages

### Submission / demo

- [ ] Public GitHub repository with meaningful commits
- [ ] Deployed demo URL works in a fresh browser session
- [ ] README setup works with documented scripts
- [ ] Multi-user test instructions verified
- [ ] Demo recording shows two-client draw, reconnect, and global undo
- [ ] Mobile / touch drawing verified
- [ ] ARCHITECTURE.md / PROTOCOL.md / DECISIONS.md / ISSUES.md / TESTING.md kept truthful

### Documentation completeness

- [x] Architecture diagrams and room lifecycle documented as implemented
- [x] Protocol schemas match shipped messages
- [x] Honest Workers vs Node.js trade-off documented
- [ ] Automated and manual test evidence recorded with dates/results

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PROTOCOL.md](./PROTOCOL.md)
- [DECISIONS.md](./DECISIONS.md)
- [ISSUES.md](./ISSUES.md) — interview prep: real bugs and how we fixed them
- [TESTING.md](./TESTING.md)
- [AI_USAGE.md](./AI_USAGE.md)
- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
