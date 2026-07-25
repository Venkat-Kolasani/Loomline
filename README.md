# Loomline

Real-time collaborative drawing canvas for the Flam Frontend R&D assignment.

**Live URL:** _not deployed yet_  
**Status:** isolated rooms + presence (drawing still local-only)

This repository intentionally uses **Cloudflare Workers + Durable Objects** (edge
JavaScript runtime), not a Node.js process. See [DECISIONS.md](./DECISIONS.md).

## What works now (implemented)

- Vite vanilla TypeScript client shell
- Landing page: create/join shareable `/r/<roomId>` links
- Worker routes `/ws?room=` to one Durable Object per room via `idFromName`
- Presence: join/leave list with deterministic participant colours
- Two stacked canvas layers with local brush/eraser/colour/width/clear
- Dirty-layer paint API (no permanent render loop)
- Scripts: `dev`, `dev:client`, `typecheck`, `test`, `build`, `deploy`
- Vitest isolation proof for two room ids

## What is planned (not implemented)

- Live stroke streaming between peers
- Authoritative committed operations + SQLite persistence
- Global undo/redo
- Cursors, reconnect snapshot recovery
- Deployed demo and multi-user drawing proof

## Quick start

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Then open `http://127.0.0.1:8787/`, create a room, and optionally open the same
room URL in a second browser profile to see presence update.

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
4. Open a **different** room id — presence must not include the first room’s users.
5. Drawing still does not sync (expected until the realtime stroke slice).

## Supported browsers

_Not claimed yet._ Target: current Chrome, Firefox, and Safari once drawing sync
and mobile passes are verified.

## Known limitations

- Drawing remains local-only (not broadcast)
- Undo/Redo disabled until server history lands
- No cursor indicators yet
- Production deploy not run yet
- Resize redraws from the in-memory local stroke list

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
- [x] User management: online presence and deterministic participant colours

### Technical stack

- [x] Frontend: vanilla TypeScript + HTML5 Canvas (no framework, no Canvas library)
- [x] Backend realtime: native browser WebSocket (no Socket.io)
- [x] Backend hosting: Cloudflare Worker + one Durable Object per room (documented trade-off vs Node.js)
- [ ] Persistence: Durable Object SQLite for committed operations

### Technical challenges

- [x] Efficient Canvas path rendering and dirty-layer redraws
- [ ] Pointer batching (at most one network batch per animation frame)
- [x] Layered committed vs live overlay model
- [x] Versioned, validated WebSocket protocol
- [ ] Server-authoritative operation ordering
- [ ] Global undo/redo without mutating the durable operation log incorrectly
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
