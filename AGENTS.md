# Loomline - agent operating contract

## Read before acting

Read this file and `PROJECT_BLUEPRINT.md` completely before making any change.
The blueprint is the agreed product and system-design contract. Do not replace it
with a generic whiteboard, a React app, or an unscoped set of features.

## Product objective

Build `Loomline`: a deployable, interview-defensible, real-time collaborative
drawing canvas for the Flam Frontend R&D assignment. It must demonstrate raw
Canvas skill, careful real-time systems design, resilience, and product polish.

The submission must be stronger because it is *correct and explainable*, not
because it has the largest feature list.

Deadline: **29 July, 15:00 IST**. Feature work freezes on 28 July evening;
29 July is only for validation, demo rehearsal, and submission.

## Non-negotiable stack

- Client: Vite, vanilla TypeScript, native HTML/CSS/DOM.
- Rendering: native Canvas 2D API. No drawing/rendering library.
- Networking: native browser WebSocket. No Socket.io.
- Backend: Cloudflare Worker routes each room to one Durable Object.
- State: one Durable Object per room; Durable Object SQLite stores committed
  operations and room metadata.
- Testing: Vitest and Cloudflare Workers-compatible integration tests.
- Deployment: Cloudflare Workers static assets + Durable Objects, one origin.

Do not introduce React, Vue, Svelte, a Canvas library, a CRDT package, an
external database, authentication, or a paid service unless the user explicitly
approves a written change to the blueprint.

## Core invariants

1. Local drawing renders immediately before a network round trip.
2. Only completed strokes become durable operations.
3. The room Durable Object assigns one strictly increasing authoritative sequence
   to every committed operation.
4. The committed Canvas is a deterministic replay of visible operations ordered
   by that sequence.
5. Live strokes render in a separate, ephemeral overlay.
6. Global undo/redo is server-owned and acts only on completed operations.
7. A new committed operation clears the global redo branch.
8. Overlapping strokes are valid; server sequence defines their stable layering.
9. A reconnecting client restores its committed state from a snapshot/replay and
   never applies an already-seen sequence twice.
10. Invalid client messages return typed recoverable errors and never crash a room.

If a proposed change weakens an invariant, stop and explain the trade-off before
editing code.

## Implementation discipline

- Build in the order in `PROJECT_BLUEPRINT.md`; do not start stretch work while
  any must-ship behavior is untested.
- Keep modules small and named by responsibility. Prefer explicit types and
  straightforward control flow over clever abstractions.
- Validate WebSocket messages at the server boundary. Use one documented,
  versioned protocol.
- Batch pointer points at most once per `requestAnimationFrame`; never emit one
  network message for every raw pointer event.
- Do not leave a permanent `requestAnimationFrame` render loop running. Render
  layers only when dirty.
- Persist a finished stroke as one operation record, not one database row per
  pointer point. Live strokes remain ephemeral and may expire safely.
- Keep WebSocket attachment data small: participant id, display name, colour,
  and last-seen metadata only.
- Treat Cloudflare hibernation as real lifecycle behavior: no in-memory state is
  assumed to survive it. Reload durable room state safely.
- Use accessible semantic controls, keyboard-focus styles, touch support, and
  responsive layout throughout; do not defer basic usability to the end.

## Explicit Cloudflare trade-off

The assignment mentions Node.js. This project intentionally uses Cloudflare's
edge JavaScript runtime because a Durable Object is a natural, server-authoritative
coordinator for each collaboration room and avoids a sleeping-container demo.

Never call Workers “Node.js” or conceal the decision. Document it honestly in
`DECISIONS.md` and be prepared to explain why a traditional Node `ws` server was
not selected for this submission.

## Required documentation

Documentation is part of every feature, not end-of-project cleanup.

Maintain these files as their concerns become implemented:

- `README.md`: live URL, setup, scripts, feature status, multi-user testing,
  supported browsers, limitations, time spent, and honest AI-use note.
- `ARCHITECTURE.md`: diagrams, rendering layers, room lifecycle, storage,
  reconnect/hibernation behavior, and scaling path.
- `PROTOCOL.md`: versioned message schemas, direction, validation, ordering and
  idempotency contract, plus examples.
- `DECISIONS.md`: trade-offs and rejected designs, especially global undo/redo,
  ordering, conflict policy, and Workers versus a Node server.
- `AI_USAGE.md`: what AI assisted with, what was manually reviewed/changed, and
  confirmation that the author can explain every retained line.
- `TESTING.md`: automated test commands, manual two-browser checklist, deployed
  smoke test, and the most recent results.

`README.md` must also keep an **Assignment Compliance Checklist** that maps each
brief requirement to the implemented, tested behavior. Leave an item unchecked
until the evidence exists; this is a reviewer aid, not a marketing claim.

For every behavioral decision, write down:

1. The problem and invariant.
2. The selected design.
3. At least one rejected alternative and why it was rejected.
4. How the behavior was verified.

Keep documentation truthful. Do not claim benchmarks, scale, browser support,
or failure handling that was not actually tested.

## Verification gate

Before declaring a unit of work complete:

1. Run the narrow unit/integration checks affected by the change.
2. Run formatting, type checking, and build commands when they exist.
3. Test the relevant browser behavior manually when it is visual or real-time.
3a. If the change touches pointer/input handling, test touch emulation or a real
    mobile device in the same session; never defer that proof to a later prompt.
4. Update the required documentation and `TESTING.md` with actual results.
5. Inspect `git diff` and `git status`; do not stage unrelated files.
6. Explain in the commit body or docs what invariant was protected and how.

Do not silence TypeScript errors, weaken tests, add `any`, or remove validation
to make a build pass.

For a user-visible milestone, start the local application and show the user a
live browser proof (or, when direct browser sharing is unavailable, provide the
local URL plus a current browser screenshot and exact reproduction steps). Do
not call a visual feature finished based only on unit tests.

## Session discipline

After completing one prompt's task, verification gate, commit, and push attempt,
stop and report status to the user. Never silently chain prompts in one session,
even when the next prompt looks obvious. The user must be able to review each
small diff and understand the code before the next slice begins.

## Git and push policy

- Preserve all existing user files and unrelated working-tree changes.
- Make small, conventional commits after each completed logical slice; do not
  collect many features in one large commit.
- Use imperative commit subjects, for example: `feat(realtime): synchronize
  streamed strokes within a room`.
- Stage only files that belong to the current slice.
- Before every commit, run the relevant verification and include its result in
  documentation or the commit body.
- When the project scripts exist, run `npm run typecheck && npm run test && npm
  run build` before every commit. If a check is not applicable yet, record why.
- Use `<type>(<scope>): <imperative description>` commit messages. Allowed types
  are `feat`, `fix`, `docs`, `chore`, `test`, and `refactor`.
- Never commit a known failure “to fix later.” Fix it or document it as a blocker
  before committing a non-broken slice.
- After **every successful commit**, immediately run `git push` to the configured
  upstream. Never force-push, amend published history, or push secrets.
- If no remote/upstream exists or push fails, do not improvise credentials or
  rewrite history. Report the exact safe command the user must run and continue
  with local commits only after recording the issue.
- Never commit `.dev.vars`, `.env*`, Cloudflare credentials, recordings with
  private data, `node_modules`, build output, or local SQLite artifacts.

## Performance targets and evidence

These are targets to measure, not claims to make without evidence:

- Local pointer-to-pixel work should fit within one frame under the stated test
  device and workload.
- The committed canvas should rebuild quickly enough to preserve interaction
  under a stated operation-count workload.
- Remote latency must be presented as an observed RTT/peer result with region,
  network, browser, and workload context.

If a target is missed, document the measurement and trade-off in `TESTING.md`
and `DECISIONS.md`. Never promise fixed 4G, cross-region, or hardware-specific
numbers that the project has not measured.

## AI-assisted development rule

AI assistance is allowed, but no retained code may be opaque to the candidate.
After an AI-assisted change, the candidate must be able to explain its purpose,
inputs/outputs, failure modes, and how it was tested. Prefer incremental code
that can be read live over a large generated subsystem. Record substantial AI
assistance honestly in `AI_USAGE.md`.

## Completion standard

No feature is complete merely because it appears to work in one browser. The
must-ship project is complete only when two clients can draw simultaneously,
global undo/redo agrees on both clients, a reconnect restores the same committed
canvas, malformed input remains recoverable, mobile drawing works, the deployed
URL has passed a fresh-session test, and the demo recording proves those claims.
