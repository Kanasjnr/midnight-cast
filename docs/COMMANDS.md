# Command reference

Full reference for `mn` (midnight-cast). For scenario-based guides, see [WORKFLOWS.md](./WORKFLOWS.md).

## Global flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable output (`{ ok, data?, error? }`) |
| `--network <name>` | `preview`, `preprod`, `mainnet`, or `local` |
| `--rpc <url>` | Override node JSON-RPC URL |
| `--indexer-http <url>` | Override indexer GraphQL HTTP URL |
| `--indexer-ws <url>` | Override indexer WebSocket URL |
| `--proof-server <url>` | Override proof server URL (ping / health) |

Environment: `MN_NETWORK` sets the default network (same as `--network`).

**Version:** `mn --version` or `mn -V` prints the CLI package version.

---

## `mn config`

### `mn config init`

Write `~/.config/midnight-cast/config.toml` (or `$XDG_CONFIG_HOME/midnight-cast/config.toml`).

```bash
mn config init
mn config init -y --network preprod
mn config init --network local --rpc http://127.0.0.1:9944 \
  --indexer-http http://127.0.0.1:8088/api/v4/graphql \
  --indexer-ws ws://127.0.0.1:8088/api/v4/graphql/ws
```

| Flag | Description |
|------|-------------|
| `-n, --network <name>` | Network to configure |
| `--rpc`, `--indexer-http`, `--indexer-ws`, `--proof-server` | Custom URLs |
| `-y, --yes` | Non-interactive; default network `preprod` |

### `mn config show`

Print resolved endpoints (built-in defaults merged with config file and flags).

```bash
mn config show
mn config show --network mainnet --json
```

---

## `mn ping [network]`

Check RPC and indexer reachability. Proof server is optional (FAIL does not fail the command).

```bash
mn ping preprod
mn ping preview --json
```

**Exit code:** `0` if RPC and indexer OK; `1` otherwise.

---

## `mn health [network]`

Aggregate **ping**, **tip**, and **versions** in one command. Good default for “is this network healthy?” before debugging.

```bash
mn health preprod
mn health preview --json
mn health preprod --fail-on-lag --fail-on-mismatch   # CI
```

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <n>` | `100` | Lag tolerance in blocks (same as `tip`) |
| `--fail-on-lag` | off | Treat indexer lag as unhealthy |
| `--fail-on-mismatch` | off | Treat live version mismatches as unhealthy |

**Sections in output:** service reachability (RPC, indexer, optional proof server), RPC vs indexer height delta, live version checks vs support matrix.

**Exit code:** `0` when RPC and indexer are up and optional CI flags pass. Version mismatches are **warnings** unless `--fail-on-mismatch` is set. Proof server failure does not fail health by itself.

---

## `mn tip [network]`

Compare latest block height: node RPC vs indexer.

```bash
mn tip preprod
mn tip mainnet --threshold 500
mn tip preprod --fail-on-lag --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <n>` | `100` | Lag tolerance in blocks |
| `--fail-on-lag` | off | Exit `1` when `\|delta\| >= threshold` |

**Exit code:** `0` by default (informational). With `--fail-on-lag`, exits `1` when `|delta| >= threshold`.

---

## `mn versions [network]` / `mn matrix [network]`

Compare live node/indexer signals to the pinned [support matrix](https://docs.midnight.network/relnotes/support-matrix) (bundled in the CLI as reference data).

```bash
mn versions preprod
mn matrix preview --json
mn versions preprod --fail-on-mismatch
cd my-dapp && mn versions preprod   # also reads local package.json deps
mn versions preprod --no-local
```

| Flag | Description |
|------|-------------|
| `--fail-on-mismatch` | Exit `1` if live checks fail (CI) |
| `--no-local` | Do not read `package.json` in cwd |

**Live checks:** node `system_version`, indexer API path (`v4`), RPC `specVersion` vs indexer `protocolVersion`.

**Reference only (not auto-checked):** ledger, indexer package version, proof-server, on-chain runtime — compare manually to matrix.

**Local deps:** reads every `@midnight-ntwrk/*` package from `package.json`. When the matrix defines `packages` pins for the network, compares local semver specs and reports **MISMATCH** (e.g. `ledger-v8`, `compact-runtime`, `onchain-runtime-v3`, `midnight-js-indexer`).

**Network warning:** if live `system_version` does not match the matrix row for `--network`, warns that endpoints may point at a different environment (e.g. preview RPC with `--network preprod`).

**Staleness:** warns when the bundled support matrix is older than 45 days (possible false mismatches).

**Override:** drop `support-matrix.json` in `~/.config/midnight-cast/` to use a newer matrix without waiting for an npm release.

---

## `mn block latest [network]`

Latest block header from node RPC (`chain_getHeader` + head block hash).

```bash
mn block latest preprod
mn block latest --json
```

**JSON / human fields:** `height`, `hash`, `parentHash`, `stateRoot`, `extrinsicsRoot`, `network`.

---

## `mn block <height> [network]`

Block header at a specific height (`chain_getBlockHash` + `chain_getHeader`).

```bash
mn block 909000 preprod
mn block 909000 --json
```

Useful to confirm a tx’s block or compare RPC state at a past height.

---

## `mn rpc <method> [params]`

Raw JSON-RPC call to the configured node.

```bash
mn rpc chain_getHeader
mn rpc chain_getHeader '[]'
mn rpc chain_getRuntimeVersion --network mainnet --json
mn rpc system_version
```

`params` must be a JSON array (or omitted for `[]`).

---

## `mn tx <hashOrId>`

Look up an indexed transaction via GraphQL HTTP.

```bash
mn tx e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c
mn tx e5c86fcd... --network preprod --json
mn tx abc123... --by identifier
```

| Flag | Default | Description |
|------|---------|-------------|
| `--by <kind>` | `hash` | `hash` or `identifier` |

**Shows:** status, fees, segment results, contract action types, DUST/zswap event ids, block height.

When DUST events are present, human output includes `mn dust-event <id>` hints per event.

**Network warning:** compares live node `system_version` to the matrix row for `--network` (same as `versions`).

When a segment failed, output notes that indexer v4 does not expose the failure reason and suggests `mn decode --raw` with the wallet/node error string.

---

## `mn decode`

Decode Midnight / Substrate errors. No network required.

### Paste full error (`--raw`)

```bash
mn decode --raw "1010: Invalid Transaction: Custom error: 186"
mn decode raw "1010: Invalid Transaction: Custom error: 186"
mn decode raw "DispatchError::Module { index: 5, error: 3 }"
```

Auto-detects and decodes everything it can find in one paste:

- Substrate **1010** / Invalid Transaction envelope
- **Custom(N)** / `Custom(N)` / hex (`0xaa`) / bare numbers (0–255)
- Known **ledger error names** (e.g. `InvalidDustSpendProof`)
- **DispatchError::Module** pallet index + error
- **JSON-RPC** codes (e.g. `"code": -32602` or RPC error text)

### Shorthand

```bash
mn decode 170
mn decode 170 --network preview    # ledger map uses preview row (8.1.0 vs 8.0.3)
mn decode 0xaa
mn decode InvalidDustSpendProof
mn decode 1010
```

**Pallet `Transaction`:** decoding `mn decode pallet pallet_midnight Transaction` adds a hint to find inner `Custom(N)` in the full error string.

**Transcript codes 179 / 180 / 181:** decoding any of these shows related proof/transcript version context (`UnsupportedProofVersion`, `GuaranteedTranscriptVersion`, `FallibleTranscriptVersion`).

### Subcommands

```bash
mn decode ledger 170
mn decode pallet 5 3
mn decode pallet pallet_midnight Transaction
mn decode 1010
mn decode jsonrpc -32602
```

| Form | Purpose |
|------|---------|
| `--raw <message>` | Parse full error string (1010, Custom N, pallet) |
| `--network <name>` | Stamp ledger map from matrix row (preview vs preprod) |
| `ledger <code>` | `Custom(N)` / LedgerApiError (0–255); shows map ledger version |
| `pallet <index> <variant>` | `DispatchError::Module` |
| `1010` | Substrate Invalid Transaction envelope guide |
| `jsonrpc <code>` | JSON-RPC errors (e.g. `-32602`) |

---

## `mn dust-event <id>`

Fetch one DUST ledger event by id via **indexer WebSocket** (v4 has no HTTP query for dust events).

```bash
mn dust-event 565975 --network preprod
mn dust-event 565975 --verbose --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | off | Full `raw` hex |
| `--timeout <ms>` | `15000` | Subscription timeout |

**Not found:** suggests `mn dust-events --from <id-10> --limit 10` to browse recent events on that network.

---

## `mn dust-events [network]`

Stream recent DUST ledger events from a starting id.

```bash
mn dust-events --network preprod --from 565900 --limit 10
mn dust-events preview --from 12340 --limit 5 --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--from <id>` | — | Start event id (recommended) |
| `--limit <n>` | `10` | Max events to collect |
| `--verbose` | off | Full `raw` hex |
| `--timeout <ms>` | `30000` | Subscription timeout |

**Tip:** If `dust-event` fails with “not found”, use `dust-events --from` to find valid ids on that network.

---

## `mn explain <topic>`

Static help (no network).

```bash
mn explain dust
```

---

## JSON output

With `--json`, successful commands print:

```json
{
  "ok": true,
  "data": { ... }
}
```

Failures:

```json
{
  "ok": false,
  "error": "Indexer unreachable"
}
```

Some commands also set non-zero exit codes for CI (`health --fail-on-lag`, `health --fail-on-mismatch`, `tip --fail-on-lag`, `versions --fail-on-mismatch`, `ping`).

---

## Networks (built-in)

| Network | Node RPC | Indexer |
|---------|----------|---------|
| `preview` | `https://rpc.preview.midnight.network` | `.../api/v4/graphql` |
| `preprod` | `https://rpc.preprod.midnight.network` | `.../api/v4/graphql` |
| `mainnet` | `https://rpc.mainnet.midnight.network` | `.../api/v4/graphql` |
| `local` | `http://127.0.0.1:9944` | user-configured |

Override any endpoint in config or with flags. See [Midnight network docs](https://docs.midnight.network/relnotes/network).
