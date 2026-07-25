# RelayCanvas - sequential Cursor prompts

Run **exactly one prompt at a time**. Each is a deliberately small, independently
reviewable commit. Read `AGENTS.md` and `PROJECT_BLUEPRINT.md` before every
prompt. Complete the verification gate, update documentation, commit, and make
the required `git push` attempt before stopping to report to the user.

Do not begin the next prompt silently. Do not claim a test, metric, or deployment
worked without showing the exact command and result.

---

## 1. Scaffold the Cloudflare edge application

```text
Read AGENTS.md and PROJECT_BLUEPRINT.md completely. Implement only the baseline
repository tooling: Vite vanilla TypeScript, Wrangler, a Cloudflare Worker that
serves built static assets, a Durable Object binding/class skeleton, and scripts
for dev, typecheck, test, build, and deploy. Do not add Canvas, WebSocket, or
room behavior.

Create README.md, ARCHITECTURE.md, PROTOCOL.md, DECISIONS.md, AI_USAGE.md, and
TESTING.md. Clearly mark planned versus implemented behavior. In README.md add
the Assignment Compliance Checklist with every item unchecked. In DECISIONS.md
document the honest Workers/Durable Objects versus Node.js trade-off.

Run clean install, typecheck, test, build, and local Worker start. Update
TESTING.md with exact results. Inspect git diff, commit only this slice as
`chore(scaffold): initialize edge application`, then run `git push`. Stop and
report commit hash, push result, commands, files changed, and blockers.
```

## 2. Add the two-layer Canvas surface

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, and current docs. Implement only the
responsive client shell and exactly two CSS-stacked Canvas elements:
`committed-canvas` and `live-canvas`. Add sizing/DPR handling, resize behavior,
accessible control placeholders, empty/connection status placeholders, and a
small rendering module with explicit dirty-layer APIs. Do not implement pointer
drawing, WebSockets, or history yet.

Document that committed-canvas is reserved for deterministic replay of
server-sequenced operations and live-canvas is reserved for ephemeral local and
remote strokes. They must never contain each other's pixels. Add tests for pure
sizing/coordinate helpers where practical, manually inspect the live local page,
and show the user the browser proof.

Update ARCHITECTURE.md, README.md, and TESTING.md. Run all available checks,
commit as `feat(canvas): add layered canvas surface`, run `git push`, then stop
and report evidence and limitations.
```

## 3. Add local pointer drawing tools

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, and existing docs. Implement only local
single-user drawing: Pointer Events with capture, immediate local rendering,
brush, eraser, colour, width, clear-local action, and keyboard-focusable,
responsive controls. Filter near-duplicate points. Render through
requestAnimationFrame only while a dirty layer needs painting; do not create a
permanent render loop. Keep the implementation independent from networking.

For this input change, test desktop pointer behavior and touch emulation or a
real mobile device in this same session. Add focused tests for geometry/point
filtering and show the user a live browser proof.

Update README.md, ARCHITECTURE.md, AI_USAGE.md, and TESTING.md with actual
results. Run typecheck, tests, and build. Commit as
`feat(canvas): add local pointer drawing tools`, run `git push`, then stop and
report evidence and any known input limitation.
```

## 4. Add room routing, landing page, and presence

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, and docs. Implement only room identity and
presence. The landing page generates a safe random room id and enters a shareable
room URL. The Worker routes the room id directly to one Durable Object using
idFromName. A joining client receives a deterministic participant id/colour and
a presence list; join/leave updates reach other participants.

Add an automated test proving two room ids route to isolated Durable Object state
with zero presence/data crossover. Document why idFromName with the room id is
safe and how the platform maps it internally. Do not send drawing points yet.

Update README.md's compliance checklist, ARCHITECTURE.md routing diagram,
PROTOCOL.md presence messages, and TESTING.md. Run checks, manually show two
rooms in a browser, commit as `feat(rooms): add isolated room routing`, run
`git push`, then stop and report evidence.
```

## 5. Stream live strokes between room participants

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, current docs, and room/presence code.
Implement native WebSocket transport for validated versioned messages:
stroke:start, stroke:points, stroke:end, stroke:live, cursor, and typed error.
Outgoing points must batch at most once per requestAnimationFrame; local drawing
remains immediate and remote in-progress strokes render only on live-canvas.
No stroke becomes durable in this slice and do not implement undo/redo.

Add protocol-validation tests and a manual two-browser proof where the peer sees
a stroke before it ends. Update PROTOCOL.md schemas, ARCHITECTURE.md data flow,
README compliance status, and TESTING.md. Run checks, show the user the live
browser demo, commit as `feat(realtime): broadcast live stroke batches`, run
`git push`, then stop and report proof and edge cases.
```

## 6. Commit ordered operations and synchronize snapshots

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, and the existing real-time code/docs.
Implement only committed operation ordering and sync: stroke:end creates one
completed operation, the room Durable Object assigns a strictly increasing
sequence, persists the operation in SQLite, and broadcasts operation:committed.
A joining/reconnecting client receives sync_state as a snapshot/replay of the
committed operation log and current sequence head. Rebuild committed-canvas only
when committed state changes. Do NOT implement undo/redo in this slice.

Add tests for sequence ordering and overlapping completed-stroke layering across
two simulated clients, plus a joining client receiving the same committed state.
Update PROTOCOL.md, ARCHITECTURE.md, README compliance status, and TESTING.md.
Run checks and a two-browser live proof. Commit as
`feat(history): add durable ordered room operations`, run `git push`, then stop
and report evidence and limitations.
```

## 7. Add global tombstone-based undo/redo

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, current docs, and the committed-operation
implementation. Implement only global server-owned undo/redo: undo adds a
history-state tombstone for the latest visible completed operation; it never
deletes or mutates the append-only operation log. Redo removes the latest valid
tombstone. A newly committed operation clears the redo branch. Live strokes are
not undoable. All clients rebuild the committed layer deterministically.

Add tests for undoing another participant's stroke, redo, redo invalidation after
a new operation, rapid sequential history requests, and two-client convergence.
Add a worked tombstone/replay example to ARCHITECTURE.md and a global-versus-
per-user decision to DECISIONS.md. Update PROTOCOL.md, README compliance status,
and TESTING.md.

Run checks and a two-browser proof, commit as
`feat(history): add global tombstone-based undo redo`, run `git push`, then stop
and report the exact invariant evidence.
```

## 8. Add reconnect and hibernation recovery

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, docs, and tests. Implement only reliable
recovery: clear connection/reconnecting UI, exponential reconnect backoff,
last-applied sequence tracking, snapshot/replay after reconnect, and duplicate
committed-event suppression. Ensure Durable Object initialization loads its
durable state safely after hibernation. Define a safe expiry/cancellation rule
for a stalled provisional stroke; do not persist live pointer points.

Add tests for refresh/reconnect convergence, duplicate operation suppression,
and Durable Object lifecycle rehydration where supported by the test environment.
Update ARCHITECTURE.md, PROTOCOL.md, DECISIONS.md, README, and TESTING.md. Run
checks and demonstrate an actual two-client reconnect locally. Commit as
`feat(resilience): recover rooms after reconnect`, run `git push`, then stop and
report evidence and limitations.
```

## 9. Harden input boundaries and failure modes

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, and all current docs. Do not add product
features. Harden the room boundary: reject malformed JSON, unknown message types,
wrong protocol versions, invalid payload shapes, and oversized payloads with a
typed error while keeping the Durable Object alive. Add a documented, per-
participant message-frame rate limit and a maximum points-per-message/payload
size limit that preserves normal rAF-batched drawing. Server serialization must
handle rapid undo/redo requests without corrupting sequence or redo state; do
not debounce and silently lose intentional actions.

Confirm that a zero-participant room has no pending timers or retained live
stroke state and is eligible for normal Durable Object hibernation. Do not add a
premature arbitrary operation-log reset; instead document the measured room-size
limit and the future checkpoint/retention strategy.

Add automated tests for malformed JSON, unknown type, oversized payload,
rate-limit trigger, rapid history requests, and zero-user cleanup where the test
runtime supports it. Update PROTOCOL.md, README limitations, DECISIONS.md, and
TESTING.md. Run checks, commit as
`fix(robustness): harden room input boundaries`, run `git push`, then stop and
report exact coverage and any lifecycle test constraint.
```

## 10. Add measured diagnostics and a load baseline

```text
Read AGENTS.md and all docs. Proceed only if every must-ship test is green. Add
a developer-only diagnostics panel enabled with `?debug=1`: measured render FPS
from requestAnimationFrame deltas, WebSocket RTT via timestamp echo, inbound and
outbound messages/sec, participant count, and committed sequence head.

Create a reproducible synthetic-load script that runs five clients in one room,
each producing 100 completed strokes. Capture available server/runtime metrics
without inventing unavailable CPU data. Record the actual browser version,
machine, network condition, workload, measurements, and limitations in
TESTING.md. Do not claim 60 FPS or a latency budget unless measured under the
stated workload.

Update ARCHITECTURE.md and DECISIONS.md with the methodology. Run checks and a
manual two-client demo, commit as
`feat(observability): add runtime metrics baseline`, run `git push`, then stop
and report the data.
```

## 11. Deploy and complete submission documentation

```text
Read AGENTS.md, PROJECT_BLUEPRINT.md, every doc, and the full test status. Do
not add product features. Configure and deploy to Cloudflare Workers/Durable
Objects without committing credentials. Verify the live URL in a fresh browser
session with two distinct clients drawing mid-stroke, joining separate rooms,
using global undo/redo, and reconnecting.

Complete README.md, ARCHITECTURE.md, PROTOCOL.md, DECISIONS.md, AI_USAGE.md, and
TESTING.md. README must include live URL, clean setup, scripts, the checked
Assignment Compliance Checklist, multi-user instructions, browser/mobile support,
known limitations, time spent, and honest AI-use note. Make every claim evidence-
backed.

Run clean-clone install, typecheck, tests, build, and deployed smoke test. Show
the user live browser proof. Commit as `docs(submission): complete delivery guide`,
run `git push`, then stop and report exact URL/evidence/blockers.
```

## 12. Pre-submission code and documentation audit

```text
Read AGENTS.md and every tracked repository file. Do not add features. Run
`git grep -inE 'TODO|FIXME|HACK|XXX'`; resolve each hit or document it honestly
in README limitations. Test README setup on a clean clone in a separate directory.
Confirm Mermaid diagrams render in GitHub preview, verify the compliance checklist
against the actual implementation, and inspect secret exposure with
`git log --all --full-history -- .env .env.* .dev.vars` plus current status.
Verify AI_USAGE.md accurately reflects substantial AI assistance.

Update TESTING.md with exact audit evidence. Run the complete verification gate,
commit as `chore(submission): audit code and documentation`, run `git push`, then
stop and report every resolved item and remaining limitation.
```

## 13. Final interview rehearsal and submission freeze

```text
Read AGENTS.md and all documentation. Do not add features. Run a clean-clone
setup, full automated checks, and a deployed two-client browser rehearsal.
Create/update DEMO_RUNBOOK.md with:

1. A timed five-minute script: create/open a room; draw live from client A;
   overlap from client B; show presence/cursors; undo; redo; briefly disconnect
   and reconnect A to show snapshot recovery; show diagnostics or mobile input;
   open ARCHITECTURE.md; show a PROTOCOL.md message example.
2. Concise prepared answers: Workers instead of Node ws; append-only log;
   global versus per-user undo; same-pixel overlap; tombstones versus CRDTs; and
   the honest 1,000-user/single-room bottleneck and partitioning scale path.
3. One live-debugging exercise: intentionally omit clearing live-canvas after a
   stroke ends, then find/fix it using the two-layer invariant within two minutes.

Update TESTING.md only with actual rehearsal evidence. Commit as
`chore(submission): prepare interview rehearsal`, run `git push`, then stop and
give the user the final evidence-based submission checklist.
```
