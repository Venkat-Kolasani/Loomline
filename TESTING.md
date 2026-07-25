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

- [ ] Touch drawing works (emulator or device)
- [ ] Controls usable on narrow viewport

### Deployed smoke

- [ ] Fresh session on live URL loads
- [ ] Two clients against deployed origin

## Results — layered canvas shell (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm run typecheck`

```text
exit 0
```

### `npm run test`

```text
Test Files  2 passed (2)
Tests  6 passed (6)
exit 0
```

Covered: Worker health + Room DO skeleton; canvas sizing/DPR helpers.

### `npm run build`

```text
vite build → dist/client
exit 0
```

### Local Worker (`npm run dev`)

```text
Ready on http://localhost:8787
GET /api/health → {"ok":true,"service":"loomline","phase":"canvas-shell"}
GET / → 200 (Loomline shell with committed + live canvases)
```

DPR check (browser): stage CSS size scaled to backing buffers on both canvases;
`committed-canvas` z-index 1, `live-canvas` z-index 2.

### Notes

- Pointer drawing, WebSocket, and rooms are not implemented yet.
- `npm run deploy` not required yet; production URL unset.
