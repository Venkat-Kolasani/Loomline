# Testing

Evidence log for Loomline. Record **exact commands and outcomes**. Do not claim
untested behavior. Sibling docs live in this `docs/` folder; the public README
is at [../README.md](../README.md).

## Documentation layout (2026-07-26)

Product markdown (architecture, protocol, decisions, testing, issues, AI usage,
blueprint, assignment) moved under `docs/`. Root `README.md` is the reviewer
entry with Mermaid overview diagrams; deep detail stays here.

## I19 / D27 — test `tsc` gap accepted (2026-07-27)

Submission decision: `npm run typecheck` does **not** typecheck `test/**`
(inherited `exclude`). Specs stay gated by Vitest. Still open by design; see
ISSUES I19 and DECISIONS D27. Not a forgotten TODO.

## Expiry-touch throttle (2026-07-26)

D26. `live_stroke_expiry` upserts are wall-clock throttled (`EXPIRY_TOUCH_INTERVAL_MS`
= 4 s) instead of once per `stroke:points` batch. Client still ≤1 points batch
per rAF (unchanged).

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 28 passed (28)
→ Tests 118 passed (118)
→ Vite production build exit 0
```

Focused proof in `test/expiry-touch-throttle.test.ts`:

| Scenario | `expiryTouchCount` |
|---|---|
| `stroke:start` + 24 rapid `stroke:points` within 5 s window | **1** (pre-fix would be **25**) |
| Next batch after 40 ms test interval elapses | **2** |

Debug `AGENT_DEBUG` instrumentation from the storage audit was stripped from
`worker/room.ts` in the same slice.

## iPad finger-draw text selection (2026-07-26)

I20 / D25. Invite URL and empty-state text no longer steal finger strokes;
finger-first tablets ≤1180px use the Room sheet shell.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 27 passed (27)
→ Tests 116 passed (116)
→ Vite production build exit 0
```

### Manual

1. iPad (or DevTools iPad + coarse pointer): open a room — invite is behind
   **Room**, not above the canvas.
2. Finger-draw on the canvas: no select-all on a text field; empty-state copy
   does not highlight.
3. Copy invite still works via the copy icon / Share link.

### Follow-up — mobile + Apple Pencil (same day)

Empty-state uses CSS `::before` (no selectable DOM text). Canvas
`touchstart`/`touchmove` are non-passive + `preventDefault`; `selectstart`
blocked on the stage. Deployed so phone/iPad Safari pick up the fix.

## Wide desktop canvas room (2026-07-27)

Desktop `.app` no longer caps at `72rem`; invite + presence share one slim bar.
Toolbar and connection status stay visible. Mobile/tablet shell CSS restored
inside the existing media query (no pointer/drawing changes).

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 29 passed (29)
→ Tests 129 passed (129)
→ Vite production build exit 0
```

### Manual

Viewport checks on `http://127.0.0.1:8793` room view (CDP `Emulation.setDeviceMetricsOverride`):

| Width | appW | stageW | chrome | toolbar | Connected |
| --- | --- | --- | --- | --- | --- |
| 1280×800 | 1280 | 1248 | flex bar ~52px | static, above stage | yes |
| 1440×900 | 1440 | 1408 | flex bar ~52px | static, above stage | yes |
| 1920×1080 | 1920 | 1888 | flex bar ~52px | static, above stage | yes |
| 390×844 (phone) | — | — | `display:none`; Room toggle `flex`; grid `topbar`/`stage`; toolbar `absolute` | floating | yes |
| 768×1024 coarse tablet | — | — | same mobile shell (`matchTabletShell: true`) | floating | yes |

Screenshots: `layout-desktop-1280.png`, `layout-desktop-1440.png`,
`layout-desktop-1920.png`, `layout-mobile-390.png`, `layout-tablet-768.png`
(under Cursor screenshot temp dir for this session).

## Line / ellipse / arrow shapes (2026-07-27)

`PROTOCOL_VERSION` 5. `shape:line` / `shape:ellipse` / `shape:arrow` reuse the
rect row shape (`start`/`end`/colour/width); only `operation_type` differs.
Drag preview is local only. D28.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 29 passed (29)
→ Tests 129 passed (129)
→ Vite production build exit 0
```

Focused proof:

| Spec | Coverage |
| --- | --- |
| `test/protocol.test.ts` | parse accept for each new kind |
| `test/shape-ops.test.ts` | two-client commit per kind + line undo |
| `test/stroke-paint.test.ts` | line / ellipse / arrow geometry |

### Manual

1. Two tabs / two WS clients in one room: draw **line**, **ellipse**, and **arrow**
   from the Shapes flyout — peer sees each only after pointer-up; both canvases
   match. Live local proof (`ws://127.0.0.1:8792`, room `shapdemo`,
   `PROTOCOL_VERSION` 5): sequences 1–3 equal on both sockets; undo removed
   arrow; both remaining ops matched; `canRedo: true`.
2. Browser UI (`http://127.0.0.1:8792`): **Shapes** opens icon flyout
   (Rectangle / Line / Ellipse / Arrow), collapses on selection, trigger shows
   the active shape icon, width label switches (e.g. Line width).

## Diamond / triangle + flyout position (2026-07-27)

`PROTOCOL_VERSION` 6. `shape:diamond` / `shape:triangle` reuse the same
bounding-box row as rect. Desktop Shapes flyout opens **down** toward the
canvas (I22 / D29); mobile opens **up**. Flyout is a 3-column two-row grid.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 29 passed (29)
→ Tests 135 passed (135)
→ Vite production build exit 0
```

Focused proof:

| Spec | Coverage |
| --- | --- |
| `test/protocol.test.ts` | parse accept for diamond / triangle |
| `test/shape-ops.test.ts` | two-client commit for diamond / triangle |
| `test/stroke-paint.test.ts` | diamond / triangle geometry |

### Manual

1. Two WS clients (`ws://127.0.0.1:8794`, room `diamtri1`, `PROTOCOL_VERSION` 6):
   diamond seq 1 + triangle seq 2 matched on both sockets; undo left diamond;
   `canRedo: true`; peer history matched.
2. Browser UI (`http://127.0.0.1:8794/r/8522519f`): Shapes flyout shows six icons
   in a 3×2 grid. CDP geometry:
   - 1280×900 / 1440×900 / 1920×1080: `direction: down`, `overlapsShare: false`,
     ~76px gap below share input.
   - 390×844 (mobile MQ): `direction: up` into stage; share row not in floating
     chrome (`overlapsShare: false`).

## Star / double arrow + flyout order (2026-07-27)

`PROTOCOL_VERSION` 7. `shape:star` / `shape:biarrow` reuse the same row shape.
Flyout reordered to closed-then-linear in a 4×2 grid (D30).

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 29 passed (29)
→ Tests 141 passed (141)
→ Vite production build exit 0
```

Focused proof:

| Spec | Coverage |
| --- | --- |
| `test/protocol.test.ts` | parse accept for star / biarrow |
| `test/shape-ops.test.ts` | two-client commit for star / biarrow |
| `test/stroke-paint.test.ts` | star / biarrow geometry |

### Manual

1. Two WS clients (`ws://127.0.0.1:8794`, room `starbia1`, `PROTOCOL_VERSION` 7):
   star + biarrow matched on both; undo left star; `canRedo: true`.
2. Served flyout order:
   `rect → ellipse → diamond → triangle → star → line → arrow → biarrow`
   in a 4×2 grid.
3. Mobile / narrow width: Shapes trigger shows icon + “Shapes”; flyout opens
   upward with named cells (later I26).

## Mobile Shapes labels (2026-07-27)

Mobile toolbar used to hide the “Shapes” word and flyout cells were icon-only
(I26). Labels are visible again so the control is discoverable.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 29 passed (29)
→ Tests 141 passed (141)
→ Vite production build exit 0
```

### Manual

1. Mobile viewport (≤720px or device): floating toolbar **Shapes** button shows
   icon + the word **Shapes** (same pattern as Brush / Eraser).
2. Open the flyout: each cell shows a short caption (Rect, Ellipse, Diamond,
   Triangle, Star, Line, Arrow, Double). Full names remain in `title` /
   `aria-label`.

## Brand favicon + share meta (2026-07-27)

Tab / home-screen icons and Open Graph assets so invite links preview as Loomline
instead of a generic globe.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ invite + scaffold share-meta tests pass
→ `dist/client` includes favicon.svg, favicon-32.png, apple-touch-icon.png,
  og-image.png, site.webmanifest
```

### Manual

1. Open the app: browser tab shows the teal Loomline mark (not the default globe).
2. Share link / OG: room HTML includes `og:title` with room id; landing uses
   absolute `og-image.png` on the live origin.

## Rectangle shape tool (2026-07-26)

`PROTOCOL_VERSION` 4. `shape:rect` commits one durable `kind: "rect"` op with
normalized `start`/`end`; drag preview is local only.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 27 passed (27)
→ Tests 116 passed (116)
→ Vite production build exit 0
```

### Two-tab manual (local `wrangler` on `:8788`, room `b1cadd84`)

1. Tab A (Artist A) + Tab B (Artist B) both Connected.
2. Tab A: Rectangle → drag (~0.2,0.25 → ~0.7,0.8). Red outline appears on A.
3. Tab B: same rectangle at matching position (ink sample count 7742 on both
   committed canvases); no live frames while dragging.
4. Tab A: Undo → inkSamples 0 on both; Undo disabled / Redo enabled on both.

Local automated two-client commit+undo also covered by `test/shape-rect.test.ts`
(116 tests green in this slice).

## Canvas-dominant mobile shell (2026-07-26)

Depends on normalized coordinates (D22 / commit `60cc752`).

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 26 passed (26)
→ Tests 113 passed (113)
→ Vite production build exit 0
```

### Emulator shell + mid-session rotate (local `wrangler dev`)

Room `8775510b`, Chromium DevTools phone metrics, no reload:

| Step | Viewport | Mobile shell | Stage share | Toolbar | Ink fractions L/R/T/B |
| --- | --- | --- | --- | --- | --- |
| Portrait after draw | 390×844 @3 | yes | 84% | absolute over stage | 0.094 / 0.905 / 0.197 / 0.703 |
| Landscape after `orientationchange` | 844×390 @3 | yes (short-height clause) | 80% | absolute over stage | 0.097 / 0.902 / 0.193 / 0.705 |

Buffer regenerated 1116×2123 → 2478×937 (not stretched). Room sheet started
collapsed (`aria-expanded=false`); expanded to show invite + presence; closed
again on stage `pointerdown`. Desktop 1200×900: toggle hidden, chrome `display:
grid`, toolbar `position: static`.

### Evidence boundary

Physical device rotation not re-run in this slice; emulator + prior physical
phone two-user session (same day) stand in. Tablet landscape (>960px wide)
intentionally uses the desktop stack.

## Normalized coordinates (2026-07-26)

Stroke, cursor, and durable operation coordinates became fractions of the canvas
box (D22 / I18). Protocol version `2 → 3`.

### Automated

```text
npm run typecheck && npm run test && npm run build
→ typecheck exit 0
→ Test Files 26 passed (26)
→ Tests 113 passed (113)
→ Vite production build exit 0 (dist/client/assets/index-*.js 35.28 kB)
```

New / changed specs: `test/normalized-coords.test.ts` (conversion, round-trip,
no clamping, zero-extent guard), `test/points.test.ts` (CSS-pixel threshold over
normalized gaps), `test/stroke-paint.test.ts` (one stroke resolved at 800×400
and again at 400×800), `test/committed-ops.test.ts` (replay takes a box).

### Browser resize proof (local `wrangler dev`, Chromium, no reload)

Room `2fb30ac7`. Three strokes committed, then the viewport was changed with
CDP `Emulation.setDeviceMetricsOverride` — no page reload, no rejoin. Ink
bounding box measured from `committed-canvas` pixel alpha, expressed as
fractions of the buffer:

| Step | Canvas CSS | Buffer / DPR | left | right | top | bottom |
| --- | --- | --- | --- | --- | --- | --- |
| Landscape (drawn here) | 1118×704 | 2236×1408 / 2 | 0.098 | 0.902 | 0.097 | 0.852 |
| Portrait phone emulation | 404×509 | 1212×1528 / 3 | 0.095 | 0.904 | 0.096 | 0.853 |
| Back to landscape | 1118×704 | 2236×1408 / 2 | 0.048 | 0.951 | 0.097 | 0.952 |

Rows 1→2: the same committed log reflowed to a flipped aspect ratio and a
different DPR; the ≤0.003 drift is the 4 px round cap being a larger fraction of
the smaller canvas. Row 3 includes one extra stroke drawn **with touch pointer
events while in portrait** at 5–95% width / 95% height; after returning to
landscape it measures `left 0.048, right 0.951, bottom 0.952`, so input captured
in one box replays correctly in another.

The buffer went 2236×1408 → 1212×1528 → 2236×1408, i.e. the bitmap was
regenerated at `cssSize × dpr` each time rather than stretched.

### Evidence boundary

Emulated portrait phone (DPR 3) via CDP, not a physical rotation on hardware
this session. Peer-to-peer agreement across two differently sized windows is
argued from the shared coordinate space and the single-client proof above; it
was not separately re-measured with two live browsers in this slice.

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

Current truth (updated 27 July 2026; older chronological sections below may
describe an earlier gate):

- Desktop: Chromium verified end-to-end. Desktop Firefox and desktop Safari were
  not separately verified.
- Mobile: PointerEvent emulation plus author-confirmed physical phone / iPad
  Safari (two-user and UI fixes I20 / I25 / I26). Narrow layout on the deployed
  URL is verified.
- GitHub history is meaningful; the repository is **private** — Flam reviewers
  need explicit access (assignment allows private + access).

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
| `npm run typecheck` | `tsc` for `client/` + `worker/` + `shared/` only (I19 / D27: specs are not in the test tsconfig file set; Vitest is the test gate) |
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
