# midnight-cast

> [!NOTE]
> This project extends the Midnight Network with additional developer tooling.

Read-only CLI for Midnight network health, indexer queries, and error decoding. Think **Foundry `cast`** for Midnight, not a wallet or app scaffold.

```bash
npx midnight-cast@latest health preprod
# or: npm i -g midnight-cast@latest && midnight-cast health preprod
```

> **Note:** midnight-cast also installs a short alias, `mn`, which runs the same commands. Other global CLIs (e.g. `@mermaid-js/mermaid-cli`, `midnight-wallet-cli`) install an `mn` too, so these docs, the hints and the JSON output always say `midnight-cast`.

```bash
midnight-cast health preprod
```

Or step by step: `midnight-cast ping preprod && midnight-cast tip preprod && midnight-cast versions preprod`

Requires **Node.js 20+** (22+ recommended). Without Node.js, the release binaries install the same commands after checking the checksum:

```bash
curl -fsSL https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.sh | sh
```

On Windows, in PowerShell: `irm https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.ps1 | iex`. Where there's no `curl`, `wget -qO- <same URL> | sh` works too. Alpine needs `libstdc++` and `libgcc` first (`apk add libstdc++ libgcc`). `MIDNIGHT_CAST_VERSION=0.2.0` pins a release and `MIDNIGHT_CAST_INSTALL_DIR` picks the directory (default `~/.local/bin`). Each archive carries build provenance: `gh attestation verify <archive> --repo Kanasjnr/midnight-cast`.

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
midnight-cast health preprod
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
midnight-cast tx <hash> --network preprod
midnight-cast decode --raw "<wallet-or-node-error>"
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
Hint:     paste wallet/node error → midnight-cast decode --raw "<error>"
Actions:  ContractCall
DUST:     665110:DustSpendProcessed
          → midnight-cast dust-event 665110
```

### Is my local stack aligned with the network?

```bash
midnight-cast versions preprod
```

Example output:

```text
Checks:
  node: expected=>=1.0.400 live=1.0.400 → OK (recommended 1.0.400)
  runtimeSpec: expected=1000300 live=1000300 → OK (node runtime spec_version vs matrix)
  indexer-api: expected=v4 live=v4 → OK (from configured indexer URL path)
  protocolVersion: expected=1000300 live=1000300 → OK (RPC specVersion vs indexer latest block)
  proof-server: expected=8.1.0 live=8.1.0 → OK (GET /version on configured proof server URL)

Summary: live stack matches matrix checks ✓
```

## Quick start

```bash
npm i -g midnight-cast          # or: npx midnight-cast …
midnight-cast config init                  # ~/.config/midnight-cast/config.toml
midnight-cast health preprod
midnight-cast decode 170
```

**Networks:** `preview`, `preprod`, `mainnet`, `local` — use `--network` or `MN_NETWORK`.

**Preprod and mainnet** go through Blockfrost, since Midnight retired its hosted preprod and mainnet endpoints (mainnet on 30 September 2026, preprod on 9 October). Blockfrost project IDs are per network: create a free **Midnight Preprod** project, a **Midnight Mainnet** one, or both, on [blockfrost.io](https://blockfrost.io), then:

```bash
export BLOCKFROST_PREPROD_PROJECT_ID=<your Midnight Preprod project ID>
export BLOCKFROST_MAINNET_PROJECT_ID=nightmainnet...
npx midnight-cast health preprod
```

Preview is still hosted by Midnight and needs no project ID. The project IDs are never printed. See [docs/COMMANDS.md](docs/COMMANDS.md#preprod-mainnet-and-blockfrost).

## Debug ladder

When something breaks, run these in order:

1. `midnight-cast health` — ping + sync + versions in one shot (`preflight --address <wallet>` before a first transaction)
2. `midnight-cast ping` — services up?
3. `midnight-cast tip` — indexer synced?
4. `midnight-cast versions` — stack matches [support matrix](https://docs.midnight.network/relnotes/support-matrix)?
5. `midnight-cast decode` — what does the error mean?
6. `midnight-cast tx` — what happened on chain?

## Common one-liners

```bash
midnight-cast health preprod --json
midnight-cast ping preprod
midnight-cast versions preprod
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186"
midnight-cast decode 179 --network preview          # ledger map stamped per network
midnight-cast tx <hash> --network preprod           # status, fees, segments; links dust-event ids
midnight-cast block 909000 preprod                  # header at height (+ hash)
midnight-cast dust-events --from 565900 --limit 10 --network preprod
midnight-cast rpc chain_getHeader --json
midnight-cast versions preprod --fail-on-mismatch   # CI; local Midnight packages (either npm scope) vs matrix pins
```

## Using with AI agents

An agent working on a Midnight project needs to know what the network is doing right now, what an error means, and what working code looks like. midnight-cast answers all three from live data and Midnight's own sources, in a form an agent can parse, and its MCP server can't change anything.

It sits next to two other sources an agent may already have. The Kapa answer engine answers questions from Midnight's documentation and examples. [Midnight Expert](https://github.com/midnightntwrk/midnight-expert) gives agents skills and MCP tools for writing and verifying Compact and SDK code. midnight-cast is the part neither covers: the live state of preview, preprod and mainnet, the meaning of a specific error code on the ledger the network runs, whether a project's versions match the network, and which of Midnight's official examples shows a pattern.

### The JSON contract

Add `--json` to any command for one stable envelope: `ok`, `data`, a structured `error` with a `kind` and `hint`, any `warnings`, and `next`, the follow-up commands an expert would run. `midnight-cast explain --json` describes every command, option, exit code and error kind in one call, and [`schemas/`](schemas) has a JSON Schema for each command's output. Exit codes are `0` for success, `1` for a failed check and `2` for a usage error. See [JSON output](docs/COMMANDS.md#json-output).

```bash
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186" --json
midnight-cast explain --json
```

### The MCP server

Agents that speak MCP can use midnight-cast directly: `midnight-cast mcp` runs an MCP server on stdio with 14 tools, `health`, `preflight`, `ping`, `tip`, `versions`, `block`, `tx`, `dust_event`, `dust_events`, `contract`, `dust_status`, `decode`, `explain` and `examples`, each returning the same envelope. For example, in Claude Code:

```bash
claude mcp add --transport stdio midnight-cast -- npx -y midnight-cast mcp
```

A sandbox or CI image without Node.js can run the same server from the [standalone binary](#midnight-cast): `midnight-cast mcp`.

### What an agent can and can't do with it

- Every MCP tool only reads, and each is marked read-only to the client. None signs or submits a transaction, and none needs a wallet, a key or a seed. The CLI's `rpc` command, which passes any JSON-RPC method to a node, isn't an MCP tool.
- `MIDNIGHT_CAST_NETWORKS` limits which networks the model may query, for example `preview,preprod`.
- Tools that reach a network are rate limited, 30 calls a minute by default (`MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE`), so a looping agent can't exhaust public endpoints or a Blockfrost plan.
- The only secrets it holds are optional Blockfrost project IDs for preprod and mainnet. They're sent only to Blockfrost and redacted from every response, so the model never sees them.
- `decode`, `explain` and `examples` work offline from data bundled with the release.

### Guidance, skill and plugin

To teach a coding agent when and how to use midnight-cast, add the guidance to your project: `midnight-cast agents init --write` appends a marked section to `AGENTS.md` (read by Codex, Cursor, Copilot, Gemini CLI, Windsurf, Aider and others; use `--file CLAUDE.md` for Claude Code), or install the portable skill with `npx skills add Kanasjnr/midnight-cast --skill midnight-cast`. The snippets are in [docs/agents](docs/agents).

In Claude Code, one plugin installs the skill, the MCP server and a `/midnight-cast:diagnose <network> [tx or error]` command. When the plugin is enabled, Claude Code asks for optional Blockfrost project IDs for preprod and mainnet and keeps them in secure storage; left empty, an exported `BLOCKFROST_PREPROD_PROJECT_ID` or `BLOCKFROST_MAINNET_PROJECT_ID` is used. If you added the server with `claude mcp add` before, remove it with `claude mcp remove midnight-cast` so only the plugin's server runs:

```bash
claude plugin marketplace add Kanasjnr/midnight-cast
claude plugin install midnight-cast@midnight-cast
```

[docs/MCP.md](docs/MCP.md) has the setup for Codex, Gemini CLI, Cursor, VS Code and others, the network allow-list, and how the Blockfrost project ID stays out of the model's sight.

## Community & support

| Need | Where |
|------|--------|
| Midnight errors, network issues, dev questions | [Midnight Discord](https://discord.gg/Ap2QZ7yq)  |
| midnight-cast bug or something not working | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |
| New command or feature idea | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) (feature request) |

`midnight-cast decode --raw "…"` auto-detects 1010 envelopes, `Custom(N)`, ledger error names, pallet module errors, and JSON-RPC codes from one pasted error. Use `--network` so the ledger map matches preview vs preprod. Pallet `Transaction` hints point to inner `Custom(N)`, and codes 179–181 show grouped transcript context. For missing codes or protocol questions, use Discord and the [Midnight docs](https://docs.midnight.network/).

## Documentation

- **[Workflows](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/WORKFLOWS.md)** — scenario guides with sample output
- **[Command reference](https://github.com/Kanasjnr/midnight-cast/blob/main/docs/COMMANDS.md)** — command-by-command reference with examples
- **[Docs index](https://github.com/Kanasjnr/midnight-cast/tree/main/docs)**

## Cast ↔ midnight-cast

```
cast block  →  midnight-cast block latest | midnight-cast block <height>
cast rpc    →  midnight-cast rpc
cast logs   →  midnight-cast dust-events
cast 4byte  →  midnight-cast decode
cast send   →  wallet / Lace (not midnight-cast)
doctor      →  midnight-cast health
```

## Development

```bash
git clone https://github.com/Kanasjnr/midnight-cast.git
cd midnight-cast && npm install && npm run build
npm link                        # global midnight-cast
npm run cli -- decode 170       # without link
npm test
INTEGRATION=1 npm run test:integration
```

## License

Apache-2.0
