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

## Live-expiry hibernation fix (`fix(realtime): preserve live-stroke expiry across hibernation`)

### Assisted by AI

- `live_stroke_expiry` SQLite helpers, alarm/eviction test with
  `evictDurableObject` / `runDurableObjectAlarm`, docs/ISSUES update

### Manually reviewed / owned by the author

- Explains why in-memory-only expiry fails under hibernatable WebSockets
- Owns the “metadata only, never points” persistence boundary

## Input boundaries (`fix(robustness): harden room input boundaries`)

### Assisted by AI

- `shared/limits.ts` + `worker/rate-limit.ts`, oversized/rate checks in
  `RoomDurableObject`, zero-user cleanup, `test/boundaries.test.ts`, docs D7

### Manually reviewed / owned by the author

- Explains why history is not debounced and why empty rooms do not wipe ops
- Owns the hibernation-eligibility claim vs what Vitest can actually prove

## Observability (`feat(observability): add runtime metrics baseline`)

### Assisted by AI

- `ping`/`pong`, `?debug=1` diagnostics panel, `/api/room-metrics`,
  `scripts/synthetic-load.mjs`, observability tests, docs D8

### Manually reviewed / owned by the author

- Owns measured vs claimed FPS/RTT language and load-script limitations
- Ran local load + two-client demo; recorded numbers in TESTING.md

## Eraser punch-through and commit retention

### Assisted by AI

- Diagnosed the gray preview and provisional-versus-committed eraser mismatch
- Split brush/live and provisional eraser/committed painters
- Added width-sized eraser cursor feedback, point-batch chunking, final-tip
  delivery, provisional retention tests, and issue documentation

### Manually reviewed / owned by the author

- Explains why erasers remain server operations even though the provisional hole
  is painted locally with `destination-out`
- Understands the rate-limit interaction that shortened committed paths and why
  cursor sends pause while drawing
- Reviewed destination-out layering, server sequence ownership, and regression
  evidence before retaining the changes

## Global durable Clear (`feat(history): synchronize global canvas clear`)

### Assisted by AI

- Discriminated stroke/clear operation model and protocol v2 update
- Durable Object SQLite migration, sequenced clear handler, client replay, and
  focused collaboration/history tests
- Architecture, protocol, decision, and verification documentation drafts

### Manually reviewed / owned by the author

- Explains why clear is an append-only replay barrier rather than row deletion
  or an ephemeral peer broadcast
- Owns the active-stroke policy: clear affects committed history at its sequence;
  strokes completed afterward remain visible at later sequences
- Reviewed undo/redo, reconnect migration, malformed-input, deployed protocol
  evidence, and the documented browser-proof limitation

## Deployment and submission documentation

### Assisted by AI

- Wrangler dry-run/deployment command execution
- Clean-clone verification, production protocol smoke script, browser evidence
  collection, and final documentation drafts

### Manually reviewed / owned by the author

- Approved Cloudflare OAuth locally; no credentials were added to source control
- Chose to keep the GitHub repository private and accepts that reviewers require
  explicit access
- Owns every evidence boundary: Chromium was tested; Firefox, Safari, a physical
  mobile device, and a demo recording are not claimed

## Artist identity (`feat(identity): remember artist name before joining`)

### Assisted by AI

- Browser-local name helper, random readable fallback, landing flow wiring,
  Worker-boundary tests, and documentation drafts

### Manually reviewed / owned by the author

- Explains why `localStorage` is a convenience only: it never controls the
  participant id, colour, room membership, or persisted canvas history
- Owns the first-time shared-link gate and reconnect behavior: the same saved
  name is resent, while the room still assigns a new anonymous participant id
- Verified name gate, welcome label, presence label, and reload path locally

## Invite sharing (`feat(rooms): add shareable invite controls`)

### Assisted by AI

- Native share/clipboard fallback helper, accessible invite control, unit tests,
  and documentation drafts

### Manually reviewed / owned by the author

- Explains why canonical invite URLs omit local debug state and do not modify
  Durable Object room state
- Owns the cancellation rule: aborting the system share sheet must not write to
  the clipboard
- Reviewed the manual-copy fallback for permission-denied or unsupported browsers

## Responsive canvas-first shell (`feat(ui): prioritize canvas space on mobile`)

### Assisted by AI

- Dynamic viewport grid, safe-area/mobile toolbar CSS, and documentation drafts

### Manually reviewed / owned by the author

- Explains why `100dvh` is used only for layout while Canvas coordinates stay in
  CSS pixels and are DPR-scaled by the existing sizing code
- Owns the outstanding physical-device proof; the responsive implementation is
  not a claim that iOS/Android was manually tested

## Active collaborator cues (`feat(presence): anchor collaborator labels to live drawing`)

### Assisted by AI

- Live-stroke endpoint cursor helper, DOM edge-placement treatment, focused
  tests, and documentation drafts

### Manually reviewed / owned by the author

- Explains why a stroke batch is the authoritative active-drawing position and
  why adding cursor messages during drawing would be redundant
- Owns the separation between DOM presence labels and Canvas drawing layers,
  including leave/reconnect cleanup and reduced-motion behavior

## Tool ergonomics (`feat(tools): separate brush and eraser controls`)

### Assisted by AI

- `tool-settings` helper, toolbar HTML/CSS, clear confirmation wiring, keyboard
  shortcut guard, focused unit tests, and documentation drafts

### Manually reviewed / owned by the author

- Explains why brush and eraser widths stay client-local and do not change the
  durable stroke schema
- Owns the clear confirmation as product safety around a room-global durable op
- Owns keyboard shortcut scoping so typing a name never triggers undo/tool swaps

## Collapsed metrics dock (`feat(observability): collapse developer metrics dock`)

### Assisted by AI

- `<details>` metrics dock markup/CSS, Display rAF sampler gating, label
  constants, observability test update, and documentation drafts

### Manually reviewed / owned by the author

- Explains why Display rAF rate is not Canvas FPS and must not be marketed as
  an SLA
- Owns pausing the rAF sampler while the dock is collapsed
- Owns keeping metrics behind `?debug=1` only

## Deploy refresh + mobile acceptance (`test(mobile): record responsive and touch acceptance evidence`)

### Assisted by AI

- Diagnosis of missing Workers Builds git link, Wrangler redeploy, optional
  GitHub Action workflow draft, live viewport/touch acceptance notes

### Manually reviewed / owned by the author

- Explains why git push alone cannot update `workers.dev` without Builds or
  Actions secrets
- Owns keeping the physical-device checklist unchecked until a real phone test
- Owns the redeploy version id and live acceptance evidence in TESTING.md

## Always-on demo Metrics dock (`feat(observability): show metrics on demo`)

### Assisted by AI

- Removing the `?debug=1` gate so the collapsed Metrics control is always
  available in a room, plus slice-7 documentation completion

### Manually reviewed / owned by the author

- Owns keeping Metrics collapsed and corner-sized so it does not cover drawing
- Owns author-confirmed physical phone two-user acceptance for slice 7
- Still owns honest metric naming (Display rAF rate ≠ Canvas FPS)

## Normalized coordinates (`refactor(canvas): normalize stroke coordinates`)

### Assisted by AI

- `client/src/canvas/normalized-coords.ts` conversion helpers, threading a
  `CanvasSpace` argument through the paint path, storing normalized remote
  cursor positions, the `matchMedia` DPR-change listener, and the new
  `normalized-coords` / resize specs

### Manually reviewed / owned by the author

- Owns why the space is per-axis fractions (all ink stays visible) and the
  accepted cost that a circle becomes an ellipse when the aspect ratio changes
- Owns keeping stroke `width` and the 1.5 px input filter in CSS pixels, and can
  explain why the filter multiplies normalized gaps by the current box
- Owns the `PROTOCOL_VERSION` `2 → 3` bump: the bytes are unchanged, the meaning
  is not, so mixed-version clients must fail loudly instead of painting garbage
- Owns the measured resize evidence in TESTING.md and the known typecheck gap
  recorded as I19 rather than silently fixed inside this slice

## Canvas-dominant mobile shell (`feat(ui): canvas-first mobile room shell`)

### Assisted by AI

- HTML/CSS/JS for the mobile Room sheet, floating toolbar, `100dvh` stage grid,
  short-landscape media query, and orientation / visualViewport resize hooks

### Manually reviewed / owned by the author

- Owns why the mobile shell also keys off short height (phone landscape often
  exceeds 640px width) and the accepted trade-off that the floating toolbar can
  cover the lowest ink
- Owns keeping desktop stacked layout and the measured emulator rotate evidence
  in TESTING.md

## Rectangle shape tool (`feat(canvas): add rectangle shape tool`)

### Assisted by AI

- Protocol `shape:rect` / `kind: "rect"`, worker storage encoding, local preview
  + single commit path, toolbar button, and integration test scaffolding

### Manually reviewed / owned by the author

- Owns why rectangles skip live fan-out and reuse the same sequenced log /
  undo machinery without a second history system (`PROTOCOL_VERSION` 4)
- Owns two-tab draw/undo verification recorded in TESTING.md

## Retained-code understanding statement

The author is responsible for every retained line and can explain its purpose,
inputs/outputs, failure modes, and verification. AI output was treated as a
draft or debugging aid, not as proof; commands, tests, browser observations, and
deployed protocol results are recorded separately in [TESTING.md](./TESTING.md).
