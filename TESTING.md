# Testing

Evidence log for Loomline. Record **exact commands and outcomes**. Do not claim
untested behavior.

## Automated commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Clean install from lockfile |
| `npm run typecheck` | TypeScript for app + tests |
| `npm run test` | Vitest + `@cloudflare/vitest-pool-workers` |
| `npm run build` | Vite production build → `dist/client` |
| `npm run dev` | Build client, then `wrangler dev` |

## Manual checklists (planned)

### Two-browser collaboration

- [ ] Two clients same room see live strokes
- [ ] Global undo/redo matches on both
- [ ] Refresh restores committed canvas
- [ ] Malformed WS payload returns typed error; room survives

### Touch / mobile

- [x] Touch drawing path exercised via PointerEvent `pointerType: "touch"` emulation
- [ ] Controls usable on narrow viewport (spot-check later with real device)

### Deployed smoke

- [ ] Fresh session on live URL loads
- [ ] Two clients against deployed origin

## Results — local drawing tools (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  3 passed (3)
Tests  12 passed (12)
exit 0
```

Includes point-filter geometry tests (`test/points.test.ts`).

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker + browser proof

```text
Ready on http://localhost:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"local-drawing"}
```

Desktop PointerEvent stroke: committed layer gained non-zero pixels; empty-state hidden.  
Touch-emulated PointerEvent stroke (`pointerType: "touch"`): accepted on same path.  
Clear: committed pixels → 0; empty-state shown again.  
Eraser tool toggles `aria-pressed` and disables colour while active.

### Notes

- No network sync in this slice.
- Undo/Redo still disabled (server-owned later).
- Screenshot kept local only (not committed).
