# midnight-cast (`mn`)

Read-only developer CLI for Midnight network health, indexer queries, error decoding. Think **Foundry `cast`** for Midnight, not a wallet or app scaffold.

```bash
npm i -g midnight-cast
mn ping preprod && mn tip preprod && mn versions preprod
```

Requires **Node.js 20+** (22+ recommended).

## What it does

| Area | Commands |
|------|----------|
| Health | `ping`, `tip`, `versions` |
| Chain | `block latest`, `rpc` |
| Errors | `decode` (ledger, pallet, 1010, jsonrpc, `--raw`) |
| Indexer | `tx`, `dust-event`, `dust-events` |
| Config | `config init`, `config show` |

No wallet keys. No signing or proving.

## Quick start

```bash
npm i -g midnight-cast          # or: npx midnight-cast …
mn config init                  # ~/.config/midnight-cast/config.toml
mn ping preprod
mn tip preprod
mn decode 170
```

**Networks:** `preview`, `preprod`, `mainnet`, `local` — use `--network` or `MN_NETWORK`.

## Debug ladder

When something breaks, run in order:

1. `mn ping` — services up?
2. `mn tip` — indexer synced?
3. `mn versions` — stack matches [support matrix](https://docs.midnight.network/relnotes/support-matrix)?
4. `mn decode` — what does the error mean?
5. `mn tx` — what happened on chain?

## Common one-liners

```bash
mn decode --raw "1010: Invalid Transaction: Custom error: 186"
mn decode 1010                          # Substrate envelope → find inner N
mn tx <hash> --network preprod          # tx status, fees, segments (+ decode hint on fail)
mn dust-events --from 565900 --limit 10 --network preprod
mn rpc chain_getHeader --json
mn versions preprod --fail-on-mismatch  # CI; scans all @midnight-ntwrk/* in package.json
```

## Community & support

| Need | Where |
|------|--------|
| Midnight errors, network issues, dev questions | [Midnight Discord](https://discord.gg/Ap2QZ7yq)  |
| `mn` bug or something not working | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |
| New command or feature idea | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) (feature request) |

`mn decode` covers documented ledger `Custom(N)` codes (map stamped with ledger version). Paste a full wallet/node error with `mn decode --raw "…"`. For codes not in the map or protocol questions — Discord + [Midnight docs](https://docs.midnight.network/) are the right place.

**Note:** `mn` may clash with `midnight-wallet-cli` on some machines (both install a `mn` binary). Use `npx midnight-cast` or `midnight-cast` if needed.

## Documentation

- **[Workflows](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/WORKFLOWS.md)** — tx failed, Custom 170, DUST sync, version skew
- **[Command reference](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/COMMANDS.md)** — every flag and exit code
- **[Docs index](https://github.com/Kanasjnr/midnight-cast/tree/main/docs)**

## Cast ↔ mn

```
cast block  →  mn block latest
cast rpc    →  mn rpc
cast logs   →  mn dust-events
cast 4byte  →  mn decode
cast send   →  wallet / Lace (not mn)
```

## Development

```bash
git clone https://github.com/Kanasjnr/midnight-cast.git
cd midnight-cast && npm install && npm run build
npm link                        # global mn
npm run mn -- decode 170        # without link
npm test
INTEGRATION=1 npm run test:integration
```

## License

Apache-2.0
