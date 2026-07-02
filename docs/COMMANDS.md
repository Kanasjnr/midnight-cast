# Command reference

Reference for `mn` (midnight-cast). For scenario guides, see [WORKFLOWS.md](./WORKFLOWS.md).

## Common workflows

Start here for the shortest path:

| Goal | Command |
|------|---------|
| Full stack health | `mn health preprod` |
| Service reachability only | `mn ping preprod` |
| Check indexer lag | `mn tip preprod` |
| Check versions vs matrix | `mn versions preprod` |
| Decode wallet/node error | `mn decode --raw "<error>"` |
| Inspect a tx | `mn tx <hash> --network preprod` |
| Inspect a block | `mn block latest preprod` or `mn block <height> preprod` |
| Inspect DUST events | `mn dust-events --network preprod --from <id>` |

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

Check RPC and indexer reachability. If a proof server URL is configured, also GET `/version` and compare it to the support matrix pin (for example `8.0.3`). Proof-server FAIL does not change the command exit code.

```bash
mn ping preprod
mn ping preview --json
```

**Proof server row:** `version=8.0.3 (matches matrix 8.0.3)` or `version=… (expected …)` on mismatch. Unreachable hosts (e.g. mainnet DNS not live yet) show as FAIL with detail.

Example output:

```text
service=rpc  status=OK  latencyMs=700
service=indexer  status=OK  latencyMs=543
service=proof-server  status=OK  latencyMs=1044  optional=true  version=8.0.3  detail=version=8.0.3 (matches matrix 8.0.3)
```

**Exit code:** `0` if RPC and indexer OK; `1` otherwise.

---

## `mn health [network]`

Run **ping**, **tip**, and **versions** in one command. Use this first when checking a network.

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

**Output sections:** service reachability, RPC vs indexer height delta, and live version checks vs support matrix.

Example output:

```text
Network: preprod
Healthy: yes

Services:
  rpc: OK (1104ms)
  indexer: OK (2226ms)
  proof-server: OK (3902ms) (optional) — version=8.0.3 (matches matrix 8.0.3)

Sync:
  RPC height:      1477767
  Indexer height:  1477765
  Delta:           2 (threshold 100)
  In sync:         yes

Versions:
  Matrix updated:  2026-06
  node: OK (expected 0.22.5, live 0.22.5)
  indexer-api: OK (expected v4, live v4)
  protocolVersion: OK (expected 22000, live 22000)
  proof-server: OK (expected 8.0.3, live 8.0.3)
```

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

Example output:

```text
network: preprod
rpcHeight: 1477612
indexerHeight: 1477609
delta: 3
threshold: 100
inSync: true
```

---

## `mn versions [network]` / `mn matrix [network]`

Compare live node/indexer signals to the pinned [support matrix](https://docs.midnight.network/relnotes/support-matrix) bundled with the CLI.

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

**Live checks:** node `system_version`, indexer API path (`v4`), RPC `specVersion` vs indexer `protocolVersion`, proof server `GET /version` when URL is configured.

**Reference only:** ledger, indexer package version, and on-chain runtime are shown for manual comparison.

**Local deps:** reads every `@midnight-ntwrk/*` package from `package.json`. When the matrix defines `packages` pins, compares local semver specs and reports **MISMATCH**.

**Network warning:** if live `system_version` does not match the selected matrix row, warns that your endpoints may point at a different environment.

**Staleness:** warns when the bundled support matrix is older than 45 days (possible false mismatches).

**Override:** drop `support-matrix.json` in `~/.config/midnight-cast/` to use a newer matrix without waiting for an npm release.

Example output:

```text
Checks:
  node: expected=0.22.5 live=0.22.5 → OK
  indexer-api: expected=v4 live=v4 → OK (from configured indexer URL path)
  protocolVersion: expected=22000 live=22000 → OK (RPC specVersion vs indexer latest block)
  proof-server: expected=8.0.3 live=8.0.3 → OK (GET /version on configured proof server URL)

Summary: live stack matches matrix checks ✓
```

---

## `mn block latest [network]`

Latest block header from node RPC (`chain_getHeader` + head block hash).

```bash
mn block latest preprod
mn block latest --json
```

**JSON / human fields:** `height`, `hash`, `parentHash`, `stateRoot`, `extrinsicsRoot`, `network`.

Example output:

```text
network: preprod
height: 1477623
hash: 0x5ebdc11e23cba3915ef231f1e3934781481c61a0998f0852b0fb3efbe9e1825d
parentHash: 0xb88e03aec9731e1f6f964c78e710c1cc6eae26ad9bf46a1ffa64dc8e8ddbc1a3
stateRoot: 0xa51cf601544001880e24a386c06f728f00552703c20b51c42f8ea03566a1dad9
extrinsicsRoot: 0x371613d5bad47555572a59088d9012c00cb5160ca11c1d10610c3bd4a7a2a105
```

---

## `mn block <height> [network]`

Read the block header at a specific height (`chain_getBlockHash` + `chain_getHeader`).

```bash
mn block 909000 preprod
mn block 909000 --json
```

Use this to confirm a tx block or inspect RPC state at a past height.

Example output:

```text
network: preprod
height: 909000
hash: 0x428660a6154a27cee57af3527cb3370ad3bbce94f461f433533b1413e24b71f4
parentHash: 0x0f3ea13ff874e823035aa0a27d94c6c79776a4076607c17079fec6519d7aa17a
stateRoot: 0x0d3efc9ac7f5a310e83bc1b83c3d283df4f8bbe8ba5bb6faff668bbd26a581f9
extrinsicsRoot: 0x3a61ec7982b80286f7908e90b481548e9f07240f80fb2dbd9f02205b05f49399
```

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

Look up an indexed transaction over GraphQL HTTP.

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

---

## `mn decode`

Decode Midnight and Substrate errors. No network required.

### Paste full error (`--raw`)

```bash
mn decode --raw "1010: Invalid Transaction: Custom error: 186"
mn decode raw "1010: Invalid Transaction: Custom error: 186"
mn decode raw "DispatchError::Module { index: 5, error: 3 }"
```

Auto-detects and decodes everything it finds in one pasted error:

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

Example output:

```text
Kind:   ledger (Custom 170)
Name:   InvalidDustSpendProof
Desc:   DUST spend proof verification failed
Fix:    Regenerate DUST spend proof
Map:    ledger 8.1.0 (preview, updated 2026-06)
Docs:   https://docs.midnight.network/nodes/error-codes
```

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

Fetch one DUST ledger event by id over **indexer WebSocket** (v4 has no HTTP query for dust events).

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

Example output:

```text
id=565900  typename=DustGenerationDtimeUpdate  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565901  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565902  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
```

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

Built-in proof server URLs: `https://proof-server.<network>.midnight.network` (`GET /` health, `GET /version` for ledger pin). **Mainnet** proof-server DNS may not resolve yet — `ping` will show FAIL until it is live.

Override any endpoint in config or with flags. See [Midnight network docs](https://docs.midnight.network/relnotes/network).
