# Loomline

Real-time collaborative drawing canvas for the Flam Frontend R&D assignment.

**Live URL:** <https://loomline.kolasanivenkat2.workers.dev>
**Repository:** <https://github.com/Venkat-Kolasani/Loomline> (private by
author choice; access must be granted to reviewers)
**Status:** deployed and production-smoke-tested on 26 July 2026

This repository intentionally uses **Cloudflare Workers + Durable Objects** (edge
JavaScript runtime), not a Node.js process. See [DECISIONS.md](./DECISIONS.md).

## What works now (implemented)

- Vite vanilla TypeScript client shell
- Landing page: create/join shareable `/r/<roomId>` links
- Browser-local artist name: readable random fallback or user nickname (1–24
  trimmed characters); returning users rejoin with that name without an account
- Room invite control: native device share sheet when available, clipboard
  fallback otherwise, plus a selectable URL when browser APIs are unavailable
- Responsive canvas-first shell: dynamic viewport sizing, safe-area padding,
  compact presence, and a single horizontally scrollable mobile tool row
- Worker routes `/ws?room=` to one Durable Object per room via `idFromName`
- Presence: join/leave list with the chosen name and deterministic participant
  colours
- Live stroke fan-out (`stroke:start` / `points` / `end` → `stroke:live`)
- Durable stroke/clear `operation:committed` records with SQLite + strictly
  increasing sequence
- Join/reconnect `sync_state` snapshot of the **visible** committed log
- Exponential reconnect backoff with Connecting / Reconnecting / Connected UI
- Duplicate committed-sequence suppression on the client
- Global server-owned undo/redo via tombstones; append-only op log
- Stalled provisional strokes expire after 30s (points not persisted; expiry
  metadata is durable so hibernation cannot leave peer overlays stuck)
- Typed rejection of malformed / oversized / rate-limited client frames
- Empty rooms clear live state + alarms (hibernation-eligible; ops retained)
- Developer metrics dock (`?debug=1`): collapsed canvas-corner **Metrics**
  disclosure with Display rAF rate, WebSocket RTT, message rates, participants,
  and sequence head (not a Canvas FPS claim)
- Synthetic load script: `npm run load` (5×100 strokes) + `/api/room-metrics`
- Remote collaborator labels: idle cursor positions plus live stroke-endpoint
  labels, with edge-aware placement (ephemeral)
- rAF-batched outgoing points; immediate local drawing
- Two stacked canvas layers with brush / partial eraser / colour / per-tool
  width presets (1–32px retained independently), circular eraser cursor, and a
  confirmed room-wide Clear (durable and undoable). Keyboard: `B` / `E` for
  tools; ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z (or Y) for global undo/redo when focus is
  not in an input.
- Dirty-layer paint API (no permanent render loop)
- Scripts: `dev`, `dev:client`, `typecheck`, `test`, `load`, `build`, `deploy`
- Vitest: isolation, protocol, live strokes, history, reconnect/expiry,
  input boundaries / rate limits / zero-user cleanup, observability

## Quick start

```bash
git clone https://github.com/Venkat-Kolasani/Loomline.git
cd Loomline
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Then open `http://127.0.0.1:8787/`, choose a name (or accept **New name**),
create a room, and open the same room URL in a second browser profile. A
first-time visitor is asked for a name before joining; a returning browser uses
its remembered local name. Draw in one client — the peer should see the stroke
**while it is still in progress**.

This setup was re-run from a clean clone on 26 July 2026: `npm ci`, typecheck,
77 tests, and the production build all passed. Cloudflare authentication is
needed only for `npm run deploy`; no credentials or tokens are stored here.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Build client assets, then start local Worker (`wrangler dev`) |
| `npm run dev:client` | Vite-only client HMR (no Worker / `/api/health`) |
| `npm run typecheck` | TypeScript checks for app + tests |
| `npm run test` | Vitest with Cloudflare Workers pool |
| `npm run load` | Synthetic 5×100 stroke load against local `wrangler dev` |
| `npm run build` | Production client build into `dist/client` |
| `npm run deploy` | Build + `wrangler deploy` (requires Cloudflare auth) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from Wrangler config |

## Multi-user testing

Use the live URL above, or run `npm run dev` and use
`http://127.0.0.1:8787/`.

1. Choose a name, then click **Create room** and use **Share link**. On a
   supported device it opens the native share sheet; otherwise it copies the
   canonical room URL. If browser permission/API support prevents copying, the
   readonly URL remains selectable for manual copy.
2. Open the same link in a second browser/profile. On a first visit, choose a
   name before joining; both presence lists should show the supplied names.
3. Draw slowly in client A — client B must show the stroke **before** A lifts
   the pointer (live overlay); A's name label should track the current stroke
   endpoint without a separate drawing-time cursor stream.
4. After A ends the stroke, both clients keep it via `operation:committed`.
5. In client B click **Undo** — both clients must remove the latest completed
   stroke and enable Redo.
6. In client A click **Redo** — both clients must restore the same stroke.
7. Click **Clear room** → confirm **Clear for everyone?** — both committed
   canvases blank. Click **Undo** to restore the prior strokes in both, then
   **Redo** to clear again.
7. Refresh either client — it gets a new participant id and restores the same
   committed canvas from `sync_state`.
8. Open a **different** room id in a third client — presence and strokes must
   not cross rooms.

Production evidence (26 July 2026):

- Browser clients `Artist-0590` and `Artist-289d` both showed presence `2`.
- Before pointer-up, the peer live layer had 8,353 opaque pixels while its
  committed layer had `0`; the peer screenshot showed the remote cursor/stroke.
- Independent WebSocket clients in `prod2601` received the same commit sequence,
  converged to 0 visible ops after global undo and 1 after redo.
- `isol2601` stayed at one participant with no live/committed crossover.
- A reconnect received `sync_state` head `1` with the committed stroke.

Full commands and constraints are in [TESTING.md](./TESTING.md).

## Supported browsers

- **Verified:** Chromium-based Cursor browser on macOS 26.2, local and deployed.
- **Input path verified:** mouse and synthetic PointerEvent touch emulation.
- **Not yet claimed:** physical iOS/Android device testing, narrow-viewport
  usability, Firefox, or Safari. The implementation uses standard Canvas 2D,
  Pointer Events, DOM, and native WebSocket APIs, but those browsers/devices
  remain unchecked until manually exercised.

## Known limitations

- Live in-progress strokes are not undoable (only completed ops)
- Reconnect assigns a new participant id and colour (no sticky identity), while
  the browser-local artist name is reused
- Reconnect uses a full visible `sync_state` snapshot (not a delta by last-seq)
- Very long strokes are stored as one JSON blob per completed op (no checkpoint
  compaction yet — see DECISIONS D7)
- Per-participant rate limit is in-memory (resets if the DO is evicted mid-abuse;
  anti-spam, not auth)
- Client chunks outgoing `stroke:points` at `MAX_POINTS_PER_MESSAGE` (64)
- Room operation-log size under heavy load is **not** load-tested; there is no
  arbitrary reset. Future: checkpoint + retention after a measured threshold.
- Browser evidence in this delivery pass is Chromium-based; Firefox, Safari,
  manual narrow-mobile layout, and a physical touch device remain unverified.
- The GitHub repository is private by author choice; reviewer access is required.

## AI use

AI assisted implementation, tests, debugging, deployment workflow, and
documentation drafts. The author manually reviewed retained changes and owns
the architecture, failure modes, and verification evidence. Details:
[AI_USAGE.md](./AI_USAGE.md).

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
- [x] Reconnect / snapshot recovery without duplicate sequence application
- [x] Recoverable typed errors for invalid client messages

### Submission / demo

- [ ] Public GitHub repository with meaningful commits (meaningful history
  exists, but repository remains private by author choice)
- [x] Deployed demo URL works in a fresh browser session
- [x] README setup works with documented scripts
- [x] Multi-user test instructions verified
- [ ] Demo recording shows two-client draw, reconnect, and global undo
- [ ] Mobile / touch drawing verified
- [x] ARCHITECTURE.md / PROTOCOL.md / DECISIONS.md / ISSUES.md / TESTING.md kept truthful

### Documentation completeness

- [x] Architecture diagrams and room lifecycle documented as implemented
- [x] Protocol schemas match shipped messages
- [x] Honest Workers vs Node.js trade-off documented
- [x] Automated and manual test evidence recorded with dates/results

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PROTOCOL.md](./PROTOCOL.md)
- [DECISIONS.md](./DECISIONS.md)
- [ISSUES.md](./ISSUES.md) — interview prep: real bugs and how we fixed them
- [TESTING.md](./TESTING.md)
- [AI_USAGE.md](./AI_USAGE.md)
- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
