# Loomline

Real-time collaborative drawing canvas for the Flam Frontend R&D assignment.

**Live URL:** _not deployed yet_  
**Status:** local drawing tools (not synced yet)

This repository intentionally uses **Cloudflare Workers + Durable Objects** (edge
JavaScript runtime), not a Node.js process. See [DECISIONS.md](./DECISIONS.md).

## What works now (implemented)

- Vite vanilla TypeScript client shell
- Wrangler project config
- Cloudflare Worker that serves built static assets via `ASSETS`
- `RoomDurableObject` binding + class skeleton (no room/WebSocket behavior)
- Two stacked canvas layers (`committed-canvas`, `live-canvas`) with DPR resize
- Dirty-layer paint API (no permanent render loop)
- Local pointer drawing: brush, eraser, colour, width, clear
- Near-duplicate point filtering; finished strokes bake onto committed layer
- Scripts: `dev`, `dev:client`, `typecheck`, `test`, `build`, `deploy`
- Vitest + Cloudflare Workers pool tests

## What is planned (not implemented)

- Room landing page and isolated room IDs
- Native WebSocket protocol and live stroke streaming
- Authoritative committed operations + SQLite persistence
- Global undo/redo
- Presence, cursors, reconnect recovery
- Deployed demo and multi-user proof

## Quick start

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Then open the local Wrangler URL (typically `http://127.0.0.1:8787`).

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

_Not available yet._ Room isolation and WebSocket sync land in later slices.

## Supported browsers

_Not claimed yet._ Target: current Chrome, Firefox, and Safari once drawing and
realtime are implemented and manually verified.

## Known limitations

- Drawing is local only — not synced over the network yet
- Undo/Redo remain disabled until server-owned history lands
- No rooms, presence, or deploy yet
- Resize redraws from the in-memory stroke list (expected for this slice)

## Time spent

Tracked per commit; update at submission freeze.

## AI use

AI assisted scaffolding and canvas-shell work. Every retained line is intended to
be explainable by the author. Details: [AI_USAGE.md](./AI_USAGE.md).

## Assignment Compliance Checklist

Leave unchecked until implemented **and** verified with evidence.

### Frontend features

- [x] Drawing tools: brush, eraser, colours, stroke width
- [ ] Real-time sync: peers see in-progress strokes, not only finished strokes
- [ ] User indicators: remote cursor / drawing position
- [ ] Conflict resolution: overlapping strokes remain stable via server sequence
- [ ] Global undo/redo across all users
- [ ] User management: online presence and deterministic participant colours

### Technical stack

- [x] Frontend: vanilla TypeScript + HTML5 Canvas (no framework, no Canvas library)
- [ ] Backend realtime: native browser WebSocket (no Socket.io)
- [ ] Backend hosting: Cloudflare Worker + one Durable Object per room (documented trade-off vs Node.js)
- [ ] Persistence: Durable Object SQLite for committed operations

### Technical challenges

- [x] Efficient Canvas path rendering and dirty-layer redraws
- [ ] Pointer batching (at most one network batch per animation frame)
- [x] Layered committed vs live overlay model
- [ ] Versioned, validated WebSocket protocol
- [ ] Server-authoritative operation ordering
- [ ] Global undo/redo without mutating the durable operation log incorrectly
- [ ] Reconnect / snapshot recovery without duplicate sequence application
- [ ] Recoverable typed errors for invalid client messages

### Submission / demo

- [ ] Public GitHub repository with meaningful commits
- [ ] Deployed demo URL works in a fresh browser session
- [ ] README setup works with documented scripts
- [ ] Multi-user test instructions verified
- [ ] Demo recording shows two-client draw, reconnect, and global undo
- [ ] Mobile / touch drawing verified
- [ ] ARCHITECTURE.md / PROTOCOL.md / DECISIONS.md / TESTING.md kept truthful

### Documentation completeness

- [ ] Architecture diagrams and room lifecycle documented as implemented
- [ ] Protocol schemas match shipped messages
- [ ] Honest Workers vs Node.js trade-off documented
- [ ] Automated and manual test evidence recorded with dates/results

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PROTOCOL.md](./PROTOCOL.md)
- [DECISIONS.md](./DECISIONS.md)
- [TESTING.md](./TESTING.md)
- [AI_USAGE.md](./AI_USAGE.md)
- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
