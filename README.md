# midnight-cast (`mn`)

> [!NOTE]
> This project extends the Midnight Network with additional developer tooling.

Read-only CLI for Midnight network health, indexer queries, and error decoding. Think **Foundry `cast`** for Midnight, not a wallet or app scaffold.

```bash
npx midnight-cast@latest health preprod
# or: npm i -g midnight-cast@latest && midnight-cast health preprod
```

> **Note:** The optional `mn` binary may clash with other global CLIs (e.g. `@mermaid-js/mermaid-cli`, `midnight-wallet-cli`). Prefer **`npx midnight-cast`** or the `midnight-cast` bin.

```bash
midnight-cast health preprod
```

Or step by step: `midnight-cast ping preprod && midnight-cast tip preprod && midnight-cast versions preprod`

Requires **Node.js 20+** (22+ recommended).

## Key capabilities

- Read RPC, indexer, and proof-server health
- Compare live stack signals to the Midnight support matrix
- Decode ledger, pallet, Substrate 1010, and JSON-RPC errors
- Inspect transactions and DUST event streams
- Query block headers and raw JSON-RPC without writing scripts

## What it does

| Area | Commands |
|------|----------|
| Health | `health`, `ping`, `tip`, `versions` |
| Chain | `block latest`, `block <height>`, `rpc` |
| Errors | `decode` (ledger, pallet, 1010, jsonrpc, `--raw`) |
| Indexer | `tx`, `dust-event`, `dust-events` |
| Config | `config init`, `config show` |

No wallet keys. No signing or proving.

## Common workflows

### Is the network healthy?

```bash
mn health preprod
```

Example output:

```text
Network: preprod
Healthy: yes

Services:
  rpc: OK (668ms)
  indexer: OK (1215ms)
  proof-server: OK (1053ms) (optional) — version=8.1.0 (matches matrix 8.1.0)

Sync:
  RPC height:      2805470
  Indexer height:  2805468
  Delta:           2 (threshold 100)
  In sync:         yes
```

### Why did my tx fail?

```bash
mn tx <hash> --network preprod
mn decode --raw "<wallet-or-node-error>"
```

Example output:

```text
Type:     RegularTransaction
ID:       232830
Hash:     e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c
Block:    909000 (428660a6154a27cee57af3527cb3370ad3bbce94f461f433533b1413e24b71f4)
Protocol: 22000
Status:   PARTIAL_SUCCESS
Fees:     paid=1 estimated=1
Segments: 0:ok, 20003:ok, 35012:fail
Failure:  indexer v4 exposes segment success only (no failure reason)
Hint:     paste wallet/node error → mn decode --raw "<error>"
Actions:  ContractCall
DUST:     665110:DustSpendProcessed
          → mn dust-event 665110
```

### Is my local stack aligned with the network?

```bash
mn versions preprod
```

Example output:

```text
Checks:
  node: expected=>=1.0.300 live=1.0.400 → OK (recommended 1.0.300)
  runtimeSpec: expected=1000300 live=1000300 → OK (node runtime spec_version vs matrix)
  indexer-api: expected=v4 live=v4 → OK (from configured indexer URL path)
  protocolVersion: expected=1000300 live=1000300 → OK (RPC specVersion vs indexer latest block)
  proof-server: expected=8.1.0 live=8.1.0 → OK (GET /version on configured proof server URL)

Summary: live stack matches matrix checks ✓
```

## Quick start

```bash
npm i -g midnight-cast          # or: npx midnight-cast …
mn config init                  # ~/.config/midnight-cast/config.toml
mn health preprod
mn decode 170
```

**Networks:** `preview`, `preprod`, `mainnet`, `local` — use `--network` or `MN_NETWORK`.

**Mainnet** goes through Blockfrost, since Midnight retired its hosted mainnet endpoints on 30 September 2026. Create a free **Midnight Mainnet** project on [blockfrost.io](https://blockfrost.io), then:

```bash
export BLOCKFROST_PROJECT_ID=nightmainnet...
npx midnight-cast health mainnet
```

The project ID is never printed. See [docs/COMMANDS.md](docs/COMMANDS.md#mainnet-and-blockfrost).

## Debug ladder

When something breaks, run these in order:

1. `mn health` — ping + sync + versions in one shot
2. `mn ping` — services up?
3. `mn tip` — indexer synced?
4. `mn versions` — stack matches [support matrix](https://docs.midnight.network/relnotes/support-matrix)?
5. `mn decode` — what does the error mean?
6. `mn tx` — what happened on chain?

## Common one-liners

```bash
mn health preprod --json
mn ping preprod
mn versions preprod
mn decode --raw "1010: Invalid Transaction: Custom error: 186"
mn decode 179 --network preview          # ledger map stamped per network
mn tx <hash> --network preprod           # status, fees, segments; links dust-event ids
mn block 909000 preprod                  # header at height (+ hash)
mn dust-events --from 565900 --limit 10 --network preprod
mn rpc chain_getHeader --json
mn versions preprod --fail-on-mismatch   # CI; local Midnight packages (either npm scope) vs matrix pins
```

## For agents and scripts

Add `--json` to any command for one stable envelope: `ok`, `data`, a structured `error` with a `kind` and `hint`, any `warnings`, and `next`, the follow-up commands an expert would run. `midnight-cast explain --json` describes every command, option, exit code and error kind in one call, and [`schemas/`](schemas) has a JSON Schema for each command's output. Exit codes are `0` for success, `1` for a failed check and `2` for a usage error. See [JSON output](docs/COMMANDS.md#json-output).

```bash
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186" --json
midnight-cast explain --json
```

## Community & support

| Need | Where |
|------|--------|
| Midnight errors, network issues, dev questions | [Midnight Discord](https://discord.gg/Ap2QZ7yq)  |
| `mn` bug or something not working | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |
| New command or feature idea | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) (feature request) |

`mn decode --raw "…"` auto-detects 1010 envelopes, `Custom(N)`, ledger error names, pallet module errors, and JSON-RPC codes from one pasted error. Use `--network` so the ledger map matches preview vs preprod. Pallet `Transaction` hints point to inner `Custom(N)`, and codes 179–181 show grouped transcript context. For missing codes or protocol questions, use Discord and the [Midnight docs](https://docs.midnight.network/).

**Note:** `mn` may clash with `midnight-wallet-cli` on some machines (both install a `mn` binary). Use `npx midnight-cast` or `midnight-cast` if needed.

## Documentation

- **[Workflows](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/WORKFLOWS.md)** — scenario guides with sample output
- **[Command reference](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/COMMANDS.md)** — command-by-command reference with examples
- **[Docs index](https://github.com/Kanasjnr/midnight-cast/tree/main/docs)**

## Cast ↔ mn

```
cast block  →  mn block latest | mn block <height>
cast rpc    →  mn rpc
cast logs   →  mn dust-events
cast 4byte  →  mn decode
cast send   →  wallet / Lace (not mn)
mn doctor   →  mn health
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
