# midnight-cast (`mn`)

Read-only developer CLI for Midnight — network health, indexer queries, and ledger error decoding. Think **Foundry `cast`** for Midnight, not a wallet or app scaffold.

## Install

```bash
npm i -g @midnight-ntwrk/midnight-cast
# or
npx @midnight-ntwrk/midnight-cast ping preprod
```

Requires **Node.js 22+**.

## Config (once)

```bash
mn config init
# writes ~/.config/midnight-cast/config.toml (network: preprod by default)

mn config show
```

Override with `--network`, `MN_NETWORK`, or per-command flags (`--rpc`, `--indexer-http`, `--indexer-ws`).

## Typical flows

**Start of day**

```bash
mn ping preprod
mn tip preprod
```

If RPC and indexer heights diverge (`|delta|` ≥ threshold), fix sync before debugging submissions.

**Custom 170 / 1010**

```bash
mn decode 170              # ledger Custom(N)
mn decode 1010             # Substrate envelope → find inner N
mn decode pallet 5 3       # DispatchError::Module
mn rpc chain_getHeader     # raw JSON-RPC
mn tip preprod
```

**DUST / sync debugging**

```bash
mn dust-event 565975 --network preprod
mn dust-events --from 565900 --limit 10 --network preprod
```

DUST commands use the indexer **WebSocket** API (`dustLedgerEvents` subscription). v4 has no HTTP query for dust events.

**New teammate**

```bash
mn config init
mn ping preprod
mn tip preprod
mn decode 170
```

## Commands

| Command | Purpose |
|---------|---------|
| `mn config init` | Write config TOML |
| `mn config show` | Resolved endpoints |
| `mn ping [network]` | RPC + indexer (+ proof server) health |
| `mn tip [network]` | RPC vs indexer height; exit 1 if lag ≥ threshold |
| `mn block latest [network]` | Latest header from RPC |
| `mn decode <code>` | Ledger `Custom(N)` (shorthand) or `1010` |
| `mn decode ledger <code>` | Ledger error by number, hex, or name |
| `mn decode pallet <index> <variant>` | Pallet dispatch error |
| `mn decode 1010` | Substrate Invalid Transaction guide |
| `mn decode jsonrpc <code>` | JSON-RPC errors (e.g. `-32602`) |
| `mn rpc <method> [params]` | Call node JSON-RPC (`params` = JSON array) |
| `mn dust-event <id>` | One DUST ledger event (WS) |
| `mn dust-events [--from N] [--limit N]` | Recent DUST events (WS) |
| `mn explain dust` | Static DUST / tDUST help |

Global: `--json` for scripts/CI.

## Cast ↔ mn

```
cast block     →  mn block latest
cast rpc       →  mn rpc
cast logs      →  mn dust-events
cast 4byte     →  mn decode
cast send      →  (use wallet / Lace — not mn)
```

## Development

```bash
npm install
npm run build

# Run locally (pick one):
npm link                    # then: mn decode 170
npm run mn -- decode 170    # no global install
node dist/cli.js decode 170
npm run dev -- decode 170    # TypeScript via tsx (no build)

npm test

# Live preprod (optional)
npm run build && INTEGRATION=1 npm run test:integration
```

## License

Apache-2.0
