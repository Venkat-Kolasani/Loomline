# Testing

Evidence log for RelayCanvas. Record **exact commands and outcomes**. Do not
claim untested behavior.

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

## Results — scaffold slice (2026-07-25)

Environment: macOS darwin 25.2.0, Node v24.12.0, npm 11.6.2.

### `npm ci`

```text
added 85 packages, and audited 86 packages in 4s
found 0 vulnerabilities
exit 0
```

### `npm run typecheck`

```text
> relaycanvas@0.1.0 typecheck
> tsc --noEmit && tsc --noEmit -p test/tsconfig.json

exit 0
```

### `npm run test`

```text
> relaycanvas@0.1.0 test
> vitest run

 RUN  v4.1.10

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  1.83s

exit 0
```

### `npm run build`

```text
> relaycanvas@0.1.0 build:client
> vite build

vite v8.1.5 building client environment for production...
✓ 5 modules transformed.
dist/client/index.html                 0.77 kB │ gzip: 0.45 kB
dist/client/assets/index-BkPPCMgo.css  0.99 kB │ gzip: 0.56 kB
dist/client/assets/index-Cq4pJHLY.js   1.31 kB │ gzip: 0.72 kB │ map: 1.51 kB
✓ built in 527ms

exit 0
```

### Local Worker start (`npm run dev`)

```text
> npm run build:client && wrangler dev
[wrangler:info] Ready on http://localhost:8787

Bindings observed:
  env.ROOM (RoomDurableObject)  Durable Object  local
  env.ASSETS                    Assets          local

curl -sS http://127.0.0.1:8787/api/health
{"ok":true,"service":"relaycanvas","phase":"scaffold"}

curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/
200
```

Static HTML title `RelayCanvas` / heading `Scaffold ready` served from `ASSETS`.

### Notes

- Canvas / WebSocket / room behavior intentionally untested (not implemented).
- `npm run deploy` not required for this slice; production URL remains unset.
- `npm run cf-typegen` regenerated `worker-configuration.d.ts` successfully before typecheck.
