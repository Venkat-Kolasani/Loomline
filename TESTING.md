# Testing

Evidence log for Loomline. Record **exact commands and outcomes**. Do not claim
untested behavior.

## Abuse-only rate limit (2026-07-26)

Valid join / stroke / cursor / history / `ping` frames no longer consume the
per-participant budget. `rate_limited` applies only to binary, oversized,
malformed, and parse-failure floods.

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 25 passed (25)
→ Tests 102 passed (102)
→ Vite production build exit 0
```

Focused: `test/boundaries.test.ts` — valid-burst never limited; malformed /
binary floods still limited.

## Multi-client acceptance + I17 rate-limit fix (2026-07-26)

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 25 passed (25)
→ Tests 103 passed (103)  # includes boundaries “valid ping flood does not block stroke commit”
→ Vite production build exit 0

npm run acceptance
→ LOOM_WS=ws://127.0.0.1:8787  → 8/8 PASS
→ LOOM_WS=wss://loomline.kolasanivenkat2.workers.dev  → 8/8 PASS
  (join, live fan-out, overlapping seqs, undo/redo, mid-join, reconnect,
   room isolation, clear+undo)
```

### Browser + peer live mid-stroke (local)

Room `http://127.0.0.1:8787/r/dc4ddbc5` (Metrics collapsed):

| Check | Result |
| --- | --- |
| Browser PointerEvent stroke commits (`stroke:start`/`points`/`end`, Undo on) | Pass |
| Node peer sees live `start` + batched `points` + `end` then `operation:committed` seq 2 | Pass |

### Mobile 390×844 touch re-proof (local, this session)

Room `http://127.0.0.1:8787/r/cf41a902` as **Mobile Check**, Chromium
`Emulation.setDeviceMetricsOverride` 390×844 `mobile:true`:

| Check | Result |
| --- | --- |
| Connected; layout tops `topbar` → `presence-panel` → `stage-wrap` → `toolbar` | Pass |
| Touch `pointerType:'touch'` draw → opaque `4614`, Undo enabled | Pass |
| Eraser selected + touch erase → opaque `2006` (ink reduced), label `Eraser width` | Pass |

### Deploy note

Git push does **not** auto-deploy this Worker. Production still needs a manual
`npm run deploy` after this fix lands if reviewers must see I17 on the live URL.

## Slice 7 complete — metrics on demo + mobile acceptance (2026-07-26)

### Metrics on the live demo

The canvas-corner **Metrics** disclosure is now mounted for every room (no
`?debug=1` required). It stays collapsed until clicked and reports Display rAF
rate, WebSocket RTT, inbound/outbound messages/s, participants, and sequence
head.

### Physical phone two-user proof

Author-confirmed on 26 July 2026: a real phone and a second client used the same
live room on <https://loomline.kolasanivenkat2.workers.dev>, exercising touch
draw, collaboration visibility, and basic room controls. Narrow-viewport
Chromium device-metrics proof from earlier the same day remains recorded below.

### Automated regression

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 24 passed (24)
→ Tests 99 passed (99)
→ Vite production build exit 0
```

### Checklist status

- [x] Narrow viewport / touch emulation on deployed URL
- [x] Physical phone two-user session on live URL
- [x] Metrics control visible on the demo without a debug query flag

## Deploy refresh + mobile acceptance gate (2026-07-26)

### Root cause of stale live URL

Cloudflare Workers Builds history for `loomline` is empty — git push never
auto-deployed. Production was last uploaded 2026-07-25 until a manual:

```text
npm run deploy
→ https://loomline.kolasanivenkat2.workers.dev
→ Current Version ID: 7f696ade-815a-46e2-aef3-52b7d1b506bf
```

Live HTML/JS after deploy includes artist name, Share link, Partial eraser,
width presets, Clear confirmation, and Metrics dock labels.

Optional CI: `.github/workflows/deploy-cloudflare.yml` (needs repository secrets
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; account id for this project is
available via `npx wrangler whoami`).

### Automated regression (same session)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 24 passed (24)
→ Tests 99 passed (99)
→ Vite production build exit 0
```

### Live browser acceptance (Chromium embedded browser)

Room `https://loomline.kolasanivenkat2.workers.dev/r/92cd5054` as **Cedar Lantern**:

| Check | Result |
| --- | --- |
| Desktop ~1920×1080 Connected + Share/Partial eraser/presets | Pass (screenshot) |
| 390×844 mobile grid `topbar / presence / stage / toolbar` | Pass (`stage` before `toolbar`) |
| Touch PointerEvent draw → committed opaque pixels `6909`, Undo enabled | Pass |
| Partial eraser + Clear confirmation show/cancel | Pass (`Partial eraser width`, clear confirm visible then cancelled) |
| Reload reconnect restores committed ink (`opaque` 2402, Undo on) | Pass |
| Tablet 768×1024 layout usable | Pass (desktop toolbar order; breakpoint is ≤640px) |

### Physical device

- [x] Real iOS or Android two-user session on a phone/tablet (author-confirmed
  2026-07-26 on the live URL; completes slice 7 with the always-on Metrics dock)

## Collapsed metrics dock gate (2026-07-26)

### Automated

```text
Focused: npm run test -- test/observability.test.ts
→ Test Files 1 passed (1)
→ Tests 4 passed (4)

npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 24 passed (24)
→ Tests 99 passed (99)
→ Vite production build exit 0
```

Label contract: Display rAF rate, WebSocket RTT, inbound/outbound messages/s,
participants, sequence head — no “FPS” / “Canvas FPS” wording in metric labels.
Dock defaults collapsed (`<details>` summary “Metrics”). Production CSS/JS
includes the canvas-corner `.debug-panel` disclosure styles and honest labels.

### Evidence boundary

Interactive expand/collapse and live RTT sampling remain for manual
`?debug=1` use; embedded localhost browser proof is not claimed in this slice.

## Tool ergonomics gate (2026-07-26)

### Automated

```text
Focused: npm run test -- test/tool-settings.test.ts
→ Test Files 1 passed (1)
→ Tests 2 passed (2)

npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 24 passed (24)
→ Tests 98 passed (98)
→ Vite production build exit 0
```

`test/tool-settings.test.ts` covers independent brush/eraser width retention and
1–32px clamping. Production build markup includes `Partial eraser`, width
presets (`2`/`4`/`8`/`16`), and `Clear for everyone?` confirmation controls.

### Evidence boundary

Embedded browser localhost navigation remains blocked. Interactive proof of
preset clicks, circular eraser cursor sizing, clear confirmation, and
input-safe keyboard shortcuts is deferred to the deployed/mobile acceptance
pass rather than claimed here.

## Active collaborator-cue gate (2026-07-26)

### Automated

```text
Focused: npm run test -- test/remote-cursors.test.ts
→ Test Files 1 passed (1)
→ Tests 2 passed (2)

npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 23 passed (23)
→ Tests 96 passed (96)
→ Vite production build exit 0
```

`test/remote-cursors.test.ts` covers choosing the latest existing live-stroke
point (rather than emitting a second cursor frame) and right/bottom edge-aware
label placement. Presence and reconnect tests already cover removal of departed
and reset peers.

### Evidence boundary

The embedded browser currently forbids new localhost navigation, so a new visual
two-tab cursor screenshot is not claimed in this session. Reproduce with two
clients in one room: hold a brush stroke in A and verify B's highlighted name
label follows the stroke tip; release and verify it becomes an idle cue; close A
and verify its cue disappears from B.

## Responsive canvas layout gate (2026-07-26)

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 22 passed (22)
→ Tests 94 passed (94)
→ Vite production build exit 0
```

The built stylesheet contains the responsive contract: `100dvh`, mobile grid
areas that place `stage` before `toolbar`, horizontal toolbar/presence overflow,
and 44px (`2.75rem`) mobile controls. Existing `test/sizing.test.ts` and pointer
tests remain in the green full suite; this CSS-only slice does not alter Canvas
coordinate conversion or input handlers.

### Evidence boundary

The in-app browser currently blocks localhost navigation, so no fresh visual
viewport screenshot or physical touch proof is claimed. The mobile checklist
remains incomplete until a real device and browser-width drawing pass are
recorded in the later acceptance prompt.

## Invite sharing gate (2026-07-26)

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 22 passed (22)
→ Tests 94 passed (94)
→ Vite production build exit 0
```

`test/invite.test.ts` proves canonical `/r/<roomId>` URL generation, successful
native sharing, clipboard fallback, share cancellation without a clipboard
write, and manual-copy fallback. Focused identity/room/invite gate passed 3
files / 15 tests.

### Local server smoke

After rebuilding, `curl --fail --silent http://127.0.0.1:8787/r/name1111 |
rg -o 'Share link|room-invite|room-link' | sort -u` returned all three expected
invite controls.

### Evidence boundary

The browser automation surface explicitly rejected new localhost navigation in
this session, so no fresh visual/share-sheet interaction is claimed. Native
share, clipboard permission behavior, and the manual fallback need a fresh
browser/deployed acceptance pass; the module behavior is unit-tested.

## Artist identity gate (2026-07-26)

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 21 passed (21)
→ Tests 89 passed (89)
→ Vite production build exit 0
```

Focused checks:

- `test/artist-name.test.ts`: client-side 1–24-character validation, readable
  deterministic random fallback, local persistence, and storage-denied fallback.
- `test/rooms.test.ts`: the Durable Object trims an incoming name, caps it at
  24 characters, and uses `Artist-<id>` only when the incoming name is blank.
- Focused gate: `npm run typecheck && npm run test -- test/artist-name.test.ts
  test/rooms.test.ts` → 2 files, 10 tests passed.

### Local browser proof

Environment: local `npm run dev` Worker at `http://127.0.0.1:8787`; Cursor
embedded Chromium on macOS 26.2; room `name1111`.

1. A first-time visit to `/r/name1111` showed the landing page, prefilled
   readable fallback `Cedar Comet`, **New name**, and room id `name1111`; no
   WebSocket room UI was visible before joining.
2. Entered `Moss Finch` and clicked **Join**. The connected room showed
   self badge `Moss Finch` and presence entry `Moss Finch (you)`.
3. Reloaded `/r/name1111`. The saved browser-local name joined automatically;
   landing stayed hidden and self/presence again showed `Moss Finch`.

### Evidence boundary

This slice has local browser proof only. The deployed URL has **not** yet been
re-smoke-tested with artist names; that proof belongs to the later deployment
acceptance prompt.

## Global durable Clear gate (2026-07-26)

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 20 passed (20)
→ Tests 84 passed (84)
→ Vite production build exit 0
```

Focused coverage:

- `test/clear-history.test.ts`: two-client clear fan-out, join/reconnect
  persistence, undo restores pre-clear strokes to both clients, redo reapplies
  clear, an active stroke completes after clear at a later sequence, malformed
  clear returns a typed error without closing the socket.
- `test/committed-ops.test.ts`: replay order `stroke → clear → stroke`.
- `test/remote-strokes.test.ts`: committed history rebuild does not discard an
  active remote eraser.
- `test/protocol.test.ts`: protocol v2 accepts `canvas:clear` and rejects its
  malformed shape.

The sandbox again printed the known non-fatal Wrangler log-file `EPERM`; Vitest
completed 84/84 and exited 0.

### Local real-server protocol proof

Environment: local Wrangler at `http://127.0.0.1:8787`, two independent Node
WebSocket clients, room `proofc01`, protocol v2.

```json
{
  "clearSequences": [2, 2],
  "undoVisibleKinds": ["stroke"],
  "redoKindsA": ["stroke", "clear"],
  "redoKindsB": ["stroke", "clear"],
  "reconnectHead": 2,
  "reconnectKinds": ["stroke", "clear"]
}
```

### Deployment and deployed convergence

```text
npm run deploy
→ https://loomline.kolasanivenkat2.workers.dev
→ Version 17786acf-30b4-494f-a858-442846983c42

GET /api/health
→ HTTP 200
→ {"ok":true,"service":"loomline","phase":"observability"}
```

Production room `clr2601x` returned the same two-client result: both clients
received clear sequence `2`; undo exposed `["stroke"]`; redo converged to
`["stroke","clear"]`; a reconnect received head `2` and the same operation kinds.

### Visual evidence boundary

The embedded browser tool failed to retain a newly created tab (two
create/navigate attempts returned “No browser tab available”), so no new visual
clear screenshot is claimed. Exact manual check on the deployed URL: open the
same room in two windows, draw, click Clear room → Confirm in either, verify
both blank; Undo must restore both and Redo must blank both again. Automated
Canvas replay and real deployed WebSocket convergence are proven above.

## Submission gate and deployed smoke (2026-07-26)

### Clean clone

Fresh clone: `/tmp/loomline-submission-clean` from `origin/main` at `fd13de0`.

```text
npm ci
→ added 85 packages; 0 vulnerabilities

npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 19 passed (19)
→ Tests 77 passed (77)
→ Vite production build exit 0
```

The same gate also passed in the working repository. The sandboxed run printed
a non-fatal Wrangler log-file `EPERM` for
`~/Library/Preferences/.wrangler/logs`; Vitest still completed 77/77 and exited
0. No application check was skipped.

### Cloudflare deployment

```text
npx wrangler deploy --dry-run
→ ROOM Durable Object + ASSETS bindings resolved; exit 0

npm run deploy
→ uploaded Worker + 4 static assets
→ https://loomline.kolasanivenkat2.workers.dev
→ Version a1fc2216-2c09-4bf7-b6b9-d9cf4f431c76
```

No application secrets are required. Wrangler OAuth was completed locally; no
credential, token, `.env`, or `.dev.vars` file was committed.

```text
GET /
→ HTTP 200 text/html

GET /api/health
→ HTTP 200
→ {"ok":true,"service":"loomline","phase":"observability"}
```

### Fresh deployed browser proof

Environment: Cursor embedded Chromium browser on macOS 26.2; production HTTPS /
WSS origin; room `10410d02`.

1. Two fresh clients connected as `Artist-0590` and `Artist-289d`; both presence
   lists showed `2`.
2. Client A started a synthetic PointerEvent stroke and remained pointer-down.
3. Before end/commit, client B measured **8,353 opaque live-layer pixels** and
   **0 committed-layer pixels**; a screenshot captured the green remote stroke,
   remote cursor label, two participants, and Connected state.
4. This proves browser rendering of peer ink before completion. Synthetic input
   is used because browser automation cannot hold a physical pointer; the normal
   mouse path uses the same PointerEvent handlers.

### Deployed protocol convergence proof

Independent WebSocket clients used production room `prod2601`; a third client
joined `isol2601`.

```text
same-room participant ids:
  72585c18-ccc7-42bf-b6ed-6ca5bf82932f
  d2142c81-883d-45a5-b176-179d9a6b1a81
presence: [2, 2]
isolated-room presence: 1
mid-stroke before end: start points 1; points batch 2
isolated live/commit crossover: false
commit sequence observed by A/B: [1, 1]
global undo visible ops A/B: [0, 0]
global redo visible ops A/B: [1, 1]
reconnect sync_state: sequenceHead 1; visible ops 1;
  strokeId "deploy-proof-stroke"
```

This proves the deployed Durable Object contract for two-client live fan-out,
room isolation, shared history, and reconnect replay. It complements—not
replaces—the visual browser proof above.

### Evidence boundaries / blockers

- Verified browser: Chromium-based Cursor browser only.
- Touch handler path was exercised with synthetic PointerEvents in an earlier
  slice; physical iOS/Android and narrow-layout usability are not verified.
- Firefox and Safari are not verified.
- Demo recording is not produced in this slice.
- GitHub history is meaningful, but the repository remains private by author
  choice; reviewers need access.

## Latest gate (2026-07-26 — eraser hole must not shrink)

```text
npm run typecheck && npm run test && npm run build
→ typecheck ok; 77 tests passed (incl. eraser-retain + batcher chunking);
  client build ok
```

Manual: paint a brush stroke, erase along it with a continuous drag, release.
The punched hole must stay after `operation:committed` (no ink bits returning
along the path). Cursor messages are suppressed while drawing so point batches
are not rate-limited away.

## Previous gate (2026-07-26 — punch-through eraser)

```text
npm run typecheck && npm run test && npm run build
→ typecheck ok; 73 tests passed (incl. stroke-paint + remote-strokes);
  client build ok
```

Manual: brush ink → eraser drag punches through while dragging (destination-out
on committed view); width slider changes hole size + cursor circle; colour
disabled for eraser. Browser proof on `http://127.0.0.1:8787/r/32a2cf79`:
committed opaque **2246 → 1944** after eraser tap; mid-stroke samples show
`a=0` hole with ink on both sides; live layer **0** gray/opaque pixels;
eraser cursor is SVG data-URL sized to width.

## Results — diagnostics + load baseline (2026-07-25)

Environment:

| Field | Value |
| --- | --- |
| Machine | Apple silicon (arm64), macOS 26.2 (Build 25C56) |
| Node | v24.12.0 |
| Network | localhost (`127.0.0.1`) — not WAN / not 4G |
| Browser (panel) | Cursor embedded browser viewing `http://127.0.0.1:8787` (Chromium-based) |
| Workload A | Idle room + light pointer stroke with `?debug=1` |
| Workload B | `npm run load` → 5 Node WebSocket clients × 100 completed strokes |

### Automated gate

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  16 passed (16)
→ Tests  68 passed (68)
→ build exit 0
```

Coverage added: `test/observability.test.ts` (ping/pong echo, room-metrics HTTP),
protocol `ping` parse tests.

### Developer panel (`?debug=1`) — measured, not an SLA

Room `obs10b02` @ `http://127.0.0.1:8787/r/obs10b02?debug=1`

| Metric | Observed |
| --- | --- |
| Display rAF rate (display cadence, idle/light; expanded Metrics dock) | **120.0 Hz** historically observed on ProMotion-class display — not Canvas paint cost or a claimed 60 FPS budget |
| WS RTT (`ping`/`pong`) | **1.2 ms** idle → **3.1 ms** after light drawing (localhost) |
| Participants | 1 idle; **3** when browser + Demo-A/B WS clients shared the room |
| Sequence head | **2** after two committed strokes |
| Inbound/outbound /s | fluctuated with traffic (panel shows rolling 1s windows) |

Limitations: panel FPS measures the diagnostics rAF sampler, not a guarantee under
heavy paint. Localhost RTT is not comparable to multi-region edge latency.

### Synthetic load (`npm run load`)

```text
LOOMLINE_URL=http://127.0.0.1:8787 npm run load
```

| Field | Value |
| --- | --- |
| Room | `6789abcd` |
| Elapsed | **3257 ms** wall clock |
| Commits | **500 / 500** (`allComplete: true`) |
| Commit rate | **153.5 commits/s** |
| Observed max sequence | **500** |
| Outbound frames (sum) | 1505 (join + 3×100 strokes × 5) |
| Inbound frames (sum) | 8504 (includes fan-out to all peers) |
| `/api/room-metrics` | `sequenceHead: 500`, `operationCount: 500`, live=0, no alarm |

**Not measured / not claimed:** Worker or Durable Object CPU%, memory, or
cross-region RTT. Clients are Node WebSockets — this is commit/fan-out load, not
Canvas paint load.

### Manual two-client proof (same session)

1. Browser tab Connected on `obs10b02?debug=1` with diagnostics visible.
2. Two Node clients (`Demo-A`, `Demo-B`) joined; presence showed 3 participants.
3. Node ping RTT ≈ **20.6 ms**; `operation:committed` sequence **2** observed on
   peer B; metrics endpoint agreed `sequenceHead: 2`.

## Latest gate (2026-07-25 — rate-limit binary frames)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  15 passed (15)
→ Tests  63 passed (63)
→ build exit 0
```

Joined binary-frame flood → `rate_limited` (limiter runs before typeof string check).

## Latest gate (2026-07-25 — UTF-8 size + pre-parse rate limit)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  15 passed (15)
→ Tests  62 passed (62)
→ build exit 0
```

Regression coverage added:

- Unicode frame with JS `.length ≤ 16384` but UTF-8 bytes over cap → `payload_too_large`
- Joined socket flooding malformed JSON → `rate_limited`
- Joined socket flooding repeated `join` → `rate_limited`

## Results — input boundaries / robustness (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  15 passed (15)
→ Tests  59 passed (59)
→ build exit 0
```

Coverage in `test/boundaries.test.ts`:

- Malformed JSON → `invalid_json`; room still accepts later messages
- Unknown type → `unsupported_type`
- Oversized frame → `payload_too_large` (`MAX_CLIENT_MESSAGE_BYTES`)
- Per-participant rate limit → `rate_limited` after `MAX_MESSAGES_PER_WINDOW`
- Rapid undo/redo serialization without sequence/redo corruption
- Zero-user cleanup: live map, expiry rows, rate entries, and alarm cleared
- Unit: `allowParticipantMessage` window reset

### Latest gate (2026-07-25 — robustness)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  15 passed (15)
→ Tests  59 passed (59)
→ build exit 0
```

### Lifecycle test constraint

The Cloudflare Vitest pool can assert `getAlarm() === null` and empty
`live_stroke_expiry` after the last socket closes. It does **not** prove the
platform actually hibernated the Durable Object. Hibernation eligibility here
means: Loomline retains no pending timers or ephemeral live state that would
keep the DO busy.

Room op-log size under load is **not** measured in this slice; no arbitrary
reset was added (see DECISIONS D7).

## Results — reconnect / hibernation recovery (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0.

### Automated

```text
typecheck exit 0
Test Files  14 passed (14)
Tests  52 passed (52)
build exit 0
```

Coverage:

- `test/reconnect-backoff.test.ts` — exponential delay bounds + jitter
- `test/reconnect.test.ts` — drop + rejoin sync_state convergence; durable-head
  SQLite rehydration probe; stalled live stroke expiry without commit
- `test/live-expiry-hibernate.test.ts` — `evictDurableObject` wipes in-memory
  live map; durable `live_stroke_expiry` + `runDurableObjectAlarm` still clears
  the peer overlay with no durable operation
- Duplicate sequence suppression in `CommittedOperationStore`

### Local two-browser proof

```text
GET /api/health → {"ok":true,"service":"loomline","phase":"reconnect"}
Room rec8a001 @ http://localhost:8787
```

1. Tab A (`Artist-607b`) completed a stroke → **5014** opaque committed pixels.
2. Tab B joined → same **5014** via `sync_state`; presence = 2; both Connected.
3. Tab B **refresh** (full reload) → new participant `Artist-7910`, Connected,
   committed canvas restored to **5014** (same as A); Undo enabled.
4. After a local `npm run build` hot-reload, wrangler hit `SQLITE_BUSY_RECOVERY`
   again (see ISSUES I7). Clients showed **Reconnecting… (try N)** until the
   runtime died — UI path observed; durable recovery already proven by step 3
   and `test/reconnect.test.ts`.

## Latest gate (2026-07-25 — live-expiry hibernation fix)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  14 passed (14)
→ Tests  52 passed (52)
→ build exit 0
```

## Latest gate (2026-07-25 — reconnect)

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files  13 passed (13)
→ Tests  51 passed (51)
→ build exit 0
```

## Automated commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Clean install from lockfile |
| `npm run typecheck` | TypeScript for app + tests |
| `npm run test` | Vitest + `@cloudflare/vitest-pool-workers` |
| `npm run build` | Vite production build → `dist/client` |
| `npm run dev` | Build client, then `wrangler dev` |

## Manual checklists

### Two-browser collaboration

- [x] Two clients same room see each other in presence
- [x] Different room ids do not share presence
- [x] Leaving client is removed from remaining clients’ presence
- [x] Live strokes sync mid-stroke (peer sees ink before pointer up)
- [x] Finished strokes persist via operation:committed (same sequence on both)
- [x] Joining client receives sync_state matching committed log
- [x] Global undo/redo matches on both
- [x] Refresh/rejoin restores committed canvas via sync_state (full snapshot;
  exponential reconnect UI + duplicate suppression shipped in Prompt 8)
- [x] Malformed stroke payload returns typed error; room survives (automated)
- [x] Mid-stroke close does not create a durable op (automated)
- [x] Brush then eraser overlap keeps sequence order (automated)

### Touch / mobile

- [x] Touch drawing path exercised via PointerEvent emulation (earlier slice)
- [x] Narrow viewport (390px) canvas-first grid + touch draw/erase/clear UX on
  deployed URL (embedded Chromium device metrics; 2026-07-26)
- [x] Controls usable on physical iOS/Android device (two-user; author-confirmed
  2026-07-26)

### Deployed smoke

- [x] Fresh session on live URL loads
- [x] Two clients against deployed origin
- [x] Mid-stroke peer ink before pointer-up
- [x] Separate room isolation
- [x] Global undo/redo convergence
- [x] Reconnect snapshot recovery
- [x] 2026-07-26 polish redeploy verified on production
- [x] Always-on canvas Metrics disclosure (no `?debug=1` required)

## Results — live stroke streaming (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  7 passed (7)
Tests  31 passed (31)
exit 0
```

Includes:

- `test/protocol.test.ts` — versioned message validation (join, stroke, cursor, rejects)
- `test/stroke-batcher.test.ts` — at most one outbound points batch per rAF
- `test/live-strokes.test.ts` — peer receives `stroke:live` start/points before end;
  invalid color → typed `error`; room still accepts a later valid stroke;
  cursor fan-out

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker + two-browser mid-stroke proof

```text
Ready on http://127.0.0.1:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"live-strokes"}
One workerd listener on :8787
```

Manual / browser automation (room `06c902e9`):

1. Tab A (`Artist-dfc6`) and Tab B (`Artist-2412`) both Connected; presence = 2.
2. Tab A synthetic pointerdown + moves **without** pointerup.
3. Tab B live-canvas had **3894** opaque pixels **before** A ended the stroke;
   empty-state hidden; remote cursor label `Artist-dfc6` visible at stroke tip.
4. Screenshot evidence: peer canvas shows brown in-progress stroke + cursor.

Invariant protected: local pixels before network; remote in-progress ink on
live overlay only; no durable sequence in this slice.

Also fixed I6: author `.app { display: grid }` overrode UA `[hidden]`; added
`[hidden] { display: none !important; }` so landing/room do not stack.

### P1 — Connecting race gate (2026-07-25)

**Bug:** stroke started before `welcome` dropped `stroke:start` but still queued
`stroke:points`; after join, batches hit `unknown_stroke`.

**Fix:** `LiveStrokeTransport` only forwards points/end for stroke ids whose
start was accepted while ready. Test: `test/live-stroke-transport.test.ts`.

### Prompt 9 hardening note (addressed 2026-07-26)

`StrokePointBatcher` chunks flushes at `MAX_POINTS_PER_MESSAGE` (see
`test/stroke-batcher.test.ts`). Combined with suppressing cursor while drawing
so point batches are not rate-limited away (I11).

## Results — durable ordered operations (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0.

### `npm run typecheck` / `test` / `build`

```text
typecheck exit 0
Test Files  10 passed (10)
Tests  39 passed (39)
build exit 0
```

Includes `test/history.test.ts`:

- two clients see the same increasing sequences for overlapping strokes
- joining client `sync_state` matches the committed log
- mid-stroke close abandons live ink (sequenceHead stays 0)
- brush then eraser overlap commits as sequences 1 then 2
- back-to-back `stroke:end` without awaiting the first commit still yields
  distinct sequences 1 and 2

Adversarial coverage in the same suite / prior transport tests:

- Connecting→connected during a stroke: `LiveStrokeTransport` suppresses
  points/end when start was not accepted (no orphan unknown_stroke / no false
  awaiting-commit).
- Socket close mid-stroke: no durable op.
- Back-to-back ends (no await between first end and second start): sequences
  1,2 without collision.
- Two users brush/eraser on overlapping content: stable server order.

### Local two-browser proof

```text
GET /api/health → {"ok":true,"service":"loomline","phase":"durable-ops"}
Room 26a9b7be
```

1. Tab A (`Artist-3f37`) drew a completed stroke; Tab B (`Artist-8251`) showed
   **5374** opaque pixels on **committed-canvas** and **0** on live (durable).
2. Tab C (`Artist-3349`) joined later — same **5374** committed opaque pixels
   via `sync_state`; presence = 3.
3. Undo/Redo remain disabled (out of scope).

## Results — global tombstone undo/redo (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0.

### Automated

```text
typecheck exit 0
Test Files  11 passed (11)
Tests  46 passed (46)
build exit 0
```

New / extended coverage in `test/history.test.ts` + `test/history-helpers.test.ts`:

- Client B undoes Client A’s completed stroke; both see empty visible set
- Redo restores the tombstone; both clients converge on the same sequences
- New commit after undo clears redo (redo is a no-op; join sees only new branch;
  `sequenceHead` still reflects the full append-only log)
- Rapid undo/undo/redo without awaits yields visible sets `a,b` → `a` → `a,b`
- `filterVisibleOperations` unit helper

### Local two-browser proof

```text
GET /api/health → {"ok":true,"service":"loomline","phase":"undo-redo"}
Room undo7a01 @ http://localhost:8787
```

1. Tab A (`Artist-6283`) drew a completed stroke → **3574** opaque pixels on
   committed-canvas; Undo enabled / Redo disabled. Tab B (`Artist-30b9`) matched
   **3574** via `operation:committed` (presence = 2, both Connected).
2. Tab B clicked **Undo** (peer undoing A’s stroke) → both tabs **0** committed
   opaque pixels; Undo disabled / Redo enabled.
3. Tab A clicked **Redo** → both tabs **3748** opaque pixels (same rebuild);
   Undo enabled / Redo disabled.

Note: opaque counts after redo can differ slightly from the pre-undo sample when
the stage resizes between paints; both clients agreed on the rebuilt count.

During an earlier attempt, local `wrangler dev` crashed with
`SQLITE_BUSY_RECOVERY` after a hot reload while sockets were open (see
`ISSUES.md`). Restarted cleanly before the successful proof above.

## Results — rooms + presence (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  4 passed (4)
Tests  17 passed (17)
exit 0
```

Includes `test/rooms.test.ts`:

- two `idFromName` rooms keep isolated Durable Object storage marks
- two-client presence: closing client B removes B from A’s presence list
- two-client presence: simulated `webSocketError` for B removes B from A’s list

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker + browser

```text
Ready on http://localhost:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"rooms-presence"}
```

Manual: create room A, open same `/r/<id>` in second context → presence shows
two participants. Open room B → presence isolated from A.

Manual leave regression (fix verification): with two clients in one room, close
or navigate away client B → client A’s presence list drops B (no stale entry).

### Presence leave fix (2026-07-25)

**Problem:** `webSocketClose` / `webSocketError` called `broadcastPresence` while
the departing socket was still in `ctx.getWebSockets()`, so other clients kept
seeing the leaver.

**Fix:** pass `excludeSocket` + `excludeParticipantId` into presence projection
and skip the departing socket when broadcasting.

**Verification:** `npm run typecheck && npm run test && npm run build` — 17/17.

### Client room reuse reset (2026-07-25)

**Problem:** `enterRoom()` cleared the visible presence list but kept
`selfParticipant` and local canvas ink; an old socket’s close could overwrite
the new connection status.

**Fix:** reset self/presence/ink on enter and leave; `RoomSocket` and room
handlers ignore events from superseded sockets.

**Verification:** `npm run typecheck && npm run test && npm run build` (Prompt 4
gate re-run after both fixes) — typecheck exit 0; Tests 17 passed (17); build
exit 0.

### Fresh single-Wrangler re-verify (2026-07-25, pre–Prompt 5)

Earlier browser checks against a long-lived `127.0.0.1:8787` instance were
**not** trusted: `/api/health` served the SPA landing HTML (asset fallback) and
WebSocket leave behavior matched the pre-fix bug — consistent with a stale or
conflicted local Worker, not with checked-in `main`.

Ops: stopped all `wrangler`/`workerd` processes, cleared `.wrangler/state`,
started **exactly one** `npm run dev`.

```text
GET http://127.0.0.1:8787/api/health
→ {"ok":true,"service":"loomline","phase":"rooms-presence"}
One workerd listener on :8787 (no second app server on that port).
```

Manual leave on that instance: room `fd850e7e`, two tabs → presence = 2;
close tab B → tab A immediately and after 1.6s shows only `Artist-6829 (you)`.

Note: local `SQLITE_BUSY` remains classified as concurrent Wrangler contention
on DO SQLite state (see `ISSUES.md` I3), not an app-code defect.

### Deferred follow-ups (not blockers)

- Focused `LocalDrawingController` pointer-up/clear/layer tests
- Markdown trailing-space cleanup before final audit
- Do not commit `.cursor/`
