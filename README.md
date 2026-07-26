# Loomline

Real-time collaborative drawing canvas for the Flam Frontend R&D assignment.

**Live URL:** <https://loomline.kolasanivenkat2.workers.dev>  
**Repository:** <https://github.com/Venkat-Kolasani/Loomline> (private by author
choice; reviewers need access)  
**Status:** deployed; production smoke + physical-phone two-user session recorded
26 July 2026

This repository uses **Cloudflare Workers + Durable Objects** (edge JavaScript
runtime), not a Node.js process. The client still uses the native browser
WebSocket API. See [DECISIONS.md](./DECISIONS.md).

## What works now

- Vanilla TypeScript + Vite client; native Canvas 2D; native WebSocket
- Landing page: create/join shareable `/r/<roomId>` links (8-char `[a-z0-9]`)
- Artist name gate: empty field; type 1–24 trimmed characters or **Random name**.
  Name is saved to `localStorage` after a successful join attempt path, but the
  field is never prefilled on load
- Invite: copy-link icon + **Share link** (native share → clipboard → selectable
  URL fallback). Invite URL is always the canonical `/r/<roomId>` path
- Tools: brush, eraser (punch-through), five colour presets + custom picker,
  independent brush/eraser widths (1–32px), confirmed room-wide **Clear room**
- Keyboard: `B` / `E`; ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z (or Y) for global undo/redo
  when focus is not in an editable control
- Two canvas layers + DOM collaborator labels (idle cursors + live stroke tips)
- Worker routes `/ws?room=` to one Durable Object per room via `idFromName`
- Presence list with chosen name + deterministic participant colours
- Live stroke fan-out; durable stroke/clear ops with strictly increasing sequence
- Join/reconnect `sync_state` of the **visible** committed log; duplicate sequence
  suppression on the client
- Global server-owned undo/redo via tombstones (append-only op log)
- 30s stalled live-stroke expiry (points in memory; expiry metadata in SQLite)
- Typed recoverable errors for malformed / oversized / rate-limited frames
- Empty rooms clear live state + alarms (ops retained; hibernation-eligible)
- Collapsed canvas-corner **Metrics** dock (Display rAF rate, WS RTT, msg/s,
  participants, sequence head) — not a Canvas FPS claim
- Synthetic load: `npm run load` (5×100 strokes) + `GET /api/room-metrics?room=`
- Vitest coverage across isolation, protocol, live strokes, history, reconnect,
  boundaries, observability, and UI helpers (102 tests as of this docs pass)

## Setup (clean clone)

Requires **Node.js ≥ 20** (verified on Node 22/24 during development).

```bash
git clone https://github.com/Venkat-Kolasani/Loomline.git
cd Loomline
npm ci
npm run typecheck
npm run test
npm run build
npm run dev
```

Then open `http://127.0.0.1:8787/`.

`npm run dev` builds the client into `dist/client`, then starts `wrangler dev`
(Worker + assets + Durable Objects on one origin). Cloudflare login is **not**
required for local `dev` / `test` / `build`. It is required only for
`npm run deploy`.

This setup was re-run from a clean dependency install on 26 July 2026:
`npm ci`, typecheck, tests, and production build all passed. As of this
documentation pass: **25** test files, **102** tests.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Build client, then local Worker (`wrangler dev`) |
| `npm run dev:client` | Vite-only HMR (no Worker / `/api/health`) |
| `npm run typecheck` | TypeScript for app + tests |
| `npm run test` | Vitest with Cloudflare Workers pool |
| `npm run load` | Synthetic 5×100 stroke load against local `wrangler dev` |
| `npm run build` | Production client → `dist/client` |
| `npm run deploy` | Build + `wrangler deploy` (Cloudflare auth) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` |

**Important:** `git push` does **not** update the live Worker by itself.
Cloudflare Workers Builds is not linked to this repo. After code changes that
should go live, run `npm run deploy`, or configure repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for
`.github/workflows/deploy-cloudflare.yml`.

## Multi-user testing (exact steps)

Use the live URL, or `npm run dev` → `http://127.0.0.1:8787/`.

1. **Client A — create room**
   - Enter a name (or **Random name**).
   - Click **Create room**.
   - Confirm connection status becomes **Connected** and presence shows you.
   - Use the copy icon or **Share link** to get the canonical room URL.

2. **Client B — join the same room**
   - Open the shared URL in a second browser profile / device / private window.
   - Enter a different name (field starts empty).
   - Click through the landing join path for that room id.
   - Both presence lists should show two named participants with different colours.

3. **Live stroke (before pointer-up)**
   - In A, hold the pointer down and draw slowly without lifting.
   - B must show the stroke on the live overlay **before** A lifts.
   - A's name label on B should track the current stroke endpoint.

4. **Commit**
   - Lift the pointer in A.
   - Both clients keep the stroke on the committed canvas via
     `operation:committed` (same server sequence).

5. **Global undo / redo**
   - In B click **Undo** — both clients remove the latest completed op; **Redo**
     enables.
   - In A click **Redo** — both restore the same stroke.

6. **Clear + history**
   - Click **Clear room** → confirm **Clear for everyone?**
   - Both committed canvases blank.
   - **Undo** restores prior visible strokes on both; **Redo** clears again.

7. **Reconnect**
   - Refresh either client.
   - It receives a new participant id/colour, must enter a name again, and
     restores the same committed canvas from `sync_state`.

8. **Room isolation**
   - Open a **different** room id in a third client.
   - Presence and strokes must not cross rooms.

Production evidence for steps 1–8 is recorded in [TESTING.md](./TESTING.md)
(26 July 2026), including mid-stroke live pixels, matching undo/redo sequences,
isolation, reconnect snapshot, and an author-confirmed physical phone session.

## Supported browsers

- **Verified:** Chromium-based Cursor browser on macOS; deployed 390px mobile
  layout + touch PointerEvent draw/erase; author-confirmed physical phone
  two-user session on the live URL (26 July 2026).
- **Input path verified:** mouse, synthetic PointerEvent touch, physical mobile
  touch.
- **Not claimed:** Firefox or Safari as primary review browsers.

## Known limitations

These are real constraints of the current code — not a backlog wishlist:

1. **Live strokes are not undoable.** Only completed durable operations enter
   the history tables.
2. **No sticky participant identity.** Each join gets a new participant id and
   colour. Display name is typed again each visit (localStorage is saved but not
   used to prefill).
3. **Full snapshot reconnect only.** Reconnect replaces the committed store from
   a full visible `sync_state`, not a last-seq delta. Needed because undo
   tombstones change visibility independently of sequence head.
4. **One SQLite JSON blob per completed stroke.** Very long strokes are not
   checkpoint-compacted (see DECISIONS D7).
5. **In-memory rate limit.** The 120 messages / 1s per-participant limit resets
   if the Durable Object is evicted mid-abuse. It is anti-spam, not auth.
6. **Client chunks `stroke:points` at 64 points** (`MAX_POINTS_PER_MESSAGE`).
7. **No measured room-size cap.** Local synthetic load reached 500 committed
   ops; there is no automatic log reset. Future checkpoint/retention needs a
   measured threshold first.
8. **Hibernation is not fully proven in Vitest.** Tests prove Loomline clears
   live state that would block hibernation and that expiry metadata survives
   eviction; they cannot prove Cloudflare platform hibernation itself.
9. **Expiry writes while drawing.** `live_stroke_expiry` is upserted on
   start/points (correctness-first; can be ~1 small SQLite write per rAF batch
   per active drawer).
10. **Browser matrix incomplete.** Firefox/Safari not claimed as primary.
11. **Private repository.** Reviewer access must be granted.
12. **Deploy is manual (or optional Actions).** Git push alone does not publish.
13. **No authentication, accounts, CRDTs, shapes/text/images, or Canvas libraries**
    — by blueprint scope.
14. **Metrics Display rAF rate** measures display cadence while the dock is open,
    not Canvas paint cost or a cross-device FPS SLA.
15. **Localhost RTT / synthetic commit rate** are not WAN or multi-region claims.
16. **Demo recording** for the assignment submission is still unchecked in the
    compliance list below.

## AI use

AI assisted implementation, tests, debugging, deployment workflow, and
documentation drafts. The author manually reviewed retained changes and owns the
architecture, failure modes, and verification evidence. Details:
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

- [ ] Public GitHub repository with meaningful commits (history exists; repo remains private by author choice)
- [x] Deployed demo URL works in a fresh browser session
- [x] README setup works with documented scripts
- [x] Multi-user test instructions verified
- [ ] Demo recording shows two-client draw, reconnect, and global undo
- [x] Mobile / touch drawing verified
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
- [ISSUES.md](./ISSUES.md)
- [TESTING.md](./TESTING.md)
- [AI_USAGE.md](./AI_USAGE.md)
- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
