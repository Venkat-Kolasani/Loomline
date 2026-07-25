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

