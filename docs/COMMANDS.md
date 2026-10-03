# Command reference

Reference for midnight-cast. For scenario guides, see [WORKFLOWS.md](./WORKFLOWS.md).

## Common workflows

Start here for the shortest path:

| Goal | Command |
|------|---------|
| Full stack health | `midnight-cast health preprod` |
| Service reachability only | `midnight-cast ping preprod` |
| Check indexer lag | `midnight-cast tip preprod` |
| Check versions vs matrix | `midnight-cast versions preprod` |
| Decode wallet/node error | `midnight-cast decode --raw "<error>"` |
| Inspect a tx | `midnight-cast tx <hash> --network preprod` |
| Inspect a block | `midnight-cast block latest preprod` or `midnight-cast block <height> preprod` |
| Inspect DUST events | `midnight-cast dust-events --network preprod --from <id>` |

## Global flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable output in a versioned envelope (see [JSON output](#json-output)) |
| `--network <name>` | `preview`, `preprod`, `mainnet`, or `local` |
| `--rpc <url>` | Override node JSON-RPC URL |
| `--indexer-http <url>` | Override indexer GraphQL HTTP URL |
| `--indexer-ws <url>` | Override indexer WebSocket URL |
| `--proof-server <url>` | Override proof server URL (ping / health) |
| `--project-id <id>` | Blockfrost project ID for mainnet |

Environment: `MN_NETWORK` sets the default network (same as `--network`). `BLOCKFROST_PROJECT_ID` supplies the Blockfrost project ID for any Blockfrost network that has none in its config section; `--project-id` overrides both.

**Version:** `midnight-cast --version` or `midnight-cast -V` prints the CLI package version.

---

## `midnight-cast config`

### `midnight-cast config init`

Write `~/.config/midnight-cast/config.toml` (or `$XDG_CONFIG_HOME/midnight-cast/config.toml`).

```bash
midnight-cast config init
midnight-cast config init -y --network preprod
midnight-cast config init --network local --rpc http://127.0.0.1:9944 \
  --indexer-http http://127.0.0.1:8088/api/v4/graphql \
  --indexer-ws ws://127.0.0.1:8088/api/v4/graphql/ws
```

| Flag | Description |
|------|-------------|
| `-n, --network <name>` | Network to configure |
| `--rpc`, `--indexer-http`, `--indexer-ws`, `--proof-server` | Custom URLs |
| `-y, --yes` | Non-interactive; default network `preprod` |

### `midnight-cast config show`

Print resolved endpoints (built-in defaults merged with config file and flags).

```bash
midnight-cast config show
midnight-cast config show --network mainnet --json
```

---

## `midnight-cast ping [network]`

Check RPC and indexer reachability. If a proof server URL is configured, also GET `/version` and compare it to the support matrix pin (for example `8.1.0`). Proof-server FAIL does not change the command exit code.

```bash
midnight-cast ping preprod
midnight-cast ping preview --json
```

**Proof server row:** `version=8.1.0 (matches matrix 8.1.0)` or `version=… (expected …)` on mismatch. Unreachable hosts (e.g. mainnet DNS not live yet) show as FAIL with detail.

Example output:

```text
service=rpc  status=OK  latencyMs=700
service=indexer  status=OK  latencyMs=543
service=proof-server  status=OK  latencyMs=1044  optional=true  version=8.1.0  detail=version=8.1.0 (matches matrix 8.1.0)
```

**Exit code:** `0` if RPC and indexer OK; `1` otherwise.

---

## `midnight-cast health [network]`

Run **ping**, **tip**, and **versions** in one command. Use this first when checking a network.

```bash
midnight-cast health preprod
midnight-cast health preview --json
midnight-cast health preprod --fail-on-lag --fail-on-mismatch   # CI
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
  rpc: OK (668ms)
  indexer: OK (1215ms)
  proof-server: OK (1053ms) (optional) — version=8.1.0 (matches matrix 8.1.0)

Sync:
  RPC height:      2805470
  Indexer height:  2805468
  Delta:           2 (threshold 100)
  In sync:         yes

Versions:
  Matrix updated:  2026-10
  node: OK (expected >=1.0.300, live 1.0.400)
  runtimeSpec: OK (expected 1000300, live 1000300)
  indexer-api: OK (expected v4, live v4)
  protocolVersion: OK (expected 1000300, live 1000300)
  proof-server: OK (expected 8.1.0, live 8.1.0)
```

**Exit code:** `0` when RPC and indexer are up and optional CI flags pass. Version mismatches are **warnings** unless `--fail-on-mismatch` is set. Proof server failure does not fail health by itself.

---

## `midnight-cast tip [network]`

Compare latest block height: node RPC vs indexer.

```bash
midnight-cast tip preprod
midnight-cast tip mainnet --threshold 500
midnight-cast tip preprod --fail-on-lag --json
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

## `midnight-cast versions [network]` / `midnight-cast matrix [network]`

Compare live node/indexer signals to the pinned [support matrix](https://docs.midnight.network/relnotes/support-matrix) bundled with the CLI.

```bash
midnight-cast versions preprod
midnight-cast matrix preview --json
midnight-cast versions preprod --fail-on-mismatch
cd my-dapp && midnight-cast versions preprod   # also reads local package.json deps
midnight-cast versions preprod --no-local
```

| Flag | Description |
|------|-------------|
| `--fail-on-mismatch` | Exit `1` if live checks fail (CI) |
| `--no-local` | Do not read `package.json` in cwd |

**Live checks:** node `system_version` against the matrix minimum (`>=minNode`; exact match for rows without one), node runtime `specVersion` against the matrix `runtimeSpec`, indexer API path (`v4`), RPC `specVersion` vs indexer `protocolVersion`, and proof server `GET /version` when a URL is configured. A minimum rather than an exact node version is used because different operators run different compatible builds: on 2 October 2026 Midnight's endpoints reported node 1.0.400 and Blockfrost's mainnet node 2.1.0, both on runtime 1000300.

**Reference only:** ledger, indexer package version, and on-chain runtime are shown for manual comparison.

**Local deps:** reads every Midnight package from `package.json` under either npm scope, `@midnight-ntwrk/*` or `@midnightntwrk/*`, using the installed version from `package-lock.json` when there is one. Matrix `packages` pins apply to a package whichever scope it uses, and a mismatch is reported as **MISMATCH**. Midnight is moving its packages to `@midnightntwrk`, with the same API and only the name changed. If the same package is installed under both scopes, directly or through another dependency, a `scope:<package>` check fails, because two copies of one package can break `instanceof` checks and types. Packages you still use from the old scope that have a stable release under the new one are listed under **npm scope** as a rename hint. As of 2 October 2026 those are `ledger-v8`, `onchain-runtime-v3`, `zkir-v2` and the `wallet-sdk*` packages. Installed versions are read from npm's `package-lock.json` only. In yarn or pnpm projects, and before `npm install`, a dependency without a concrete version is listed as not resolved instead of being compared.

**Network warning:** if the live node or runtime spec doesn't fit the selected matrix row, warns that your endpoints may point at a different environment.

**Staleness:** warns when the bundled support matrix is older than 45 days (possible false mismatches).

**Override:** drop `support-matrix.json` in `~/.config/midnight-cast/` to use a newer matrix without waiting for an npm release.

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

---

## `midnight-cast block latest [network]`

Latest block header from node RPC (`chain_getHeader` + head block hash).

```bash
midnight-cast block latest preprod
midnight-cast block latest --json
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

## `midnight-cast block <height> [network]`

Read the block header at a specific height (`chain_getBlockHash` + `chain_getHeader`).

```bash
midnight-cast block 909000 preprod
midnight-cast block 909000 --json
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

## `midnight-cast rpc <method> [params]`

Raw JSON-RPC call to the configured node.

```bash
midnight-cast rpc chain_getHeader
midnight-cast rpc chain_getHeader '[]'
midnight-cast rpc chain_getRuntimeVersion --network mainnet --json
midnight-cast rpc system_version
```

`params` must be a JSON array (or omitted for `[]`).

---

## `midnight-cast tx <hashOrId>`

Look up an indexed transaction over GraphQL HTTP.

```bash
midnight-cast tx e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c
midnight-cast tx e5c86fcd... --network preprod --json
midnight-cast tx abc123... --by identifier
```

| Flag | Default | Description |
|------|---------|-------------|
| `--by <kind>` | `hash` | `hash` or `identifier` |

**Shows:** status, fees, segment results, contract action types, DUST/zswap event ids, block height.

When DUST events are present, human output includes `midnight-cast dust-event <id>` hints per event.

**Network warning:** compares live node `system_version` to the matrix row for `--network` (same as `versions`).

When a segment failed, output notes that indexer v4 does not expose the failure reason and suggests `midnight-cast decode --raw` with the wallet/node error string.

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

---

## `midnight-cast decode`

Decode Midnight and Substrate errors. No network required.

### Paste full error (`--raw`)

```bash
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186"
midnight-cast decode raw "1010: Invalid Transaction: Custom error: 186"
midnight-cast decode raw "DispatchError::Module { index: 5, error: 3 }"
```

Auto-detects and decodes everything it finds in one pasted error:

- Substrate **1010** / Invalid Transaction envelope
- **Custom(N)** / `Custom(N)` / hex (`0xaa`) / bare numbers (0–255)
- Known **ledger error names** (e.g. `InvalidDustSpendProof`)
- **DispatchError::Module** pallet index + error
- **JSON-RPC** codes (e.g. `"code": -32602` or RPC error text)

### Shorthand

```bash
midnight-cast decode 170
midnight-cast decode 170 --network preview    # ledger map uses preview row (8.1.0 vs 8.0.3)
midnight-cast decode 0xaa
midnight-cast decode InvalidDustSpendProof
midnight-cast decode 1010
```

**Pallet `Transaction`:** decoding `midnight-cast decode pallet pallet_midnight Transaction` adds a hint to find inner `Custom(N)` in the full error string.

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
midnight-cast decode ledger 170
midnight-cast decode pallet 5 3
midnight-cast decode pallet pallet_midnight Transaction
midnight-cast decode 1010
midnight-cast decode jsonrpc -32602
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

## `midnight-cast dust-event <id>`

Fetch one DUST ledger event by id over **indexer WebSocket** (v4 has no HTTP query for dust events).

```bash
midnight-cast dust-event 565975 --network preprod
midnight-cast dust-event 565975 --verbose --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | off | Full `raw` hex |
| `--timeout <ms>` | `15000` | Subscription timeout |

**Not found:** suggests `midnight-cast dust-events --from <id-10> --limit 10` to browse recent events on that network.

---

## `midnight-cast dust-events [network]`

Stream recent DUST ledger events from a starting id.

```bash
midnight-cast dust-events --network preprod --from 565900 --limit 10
midnight-cast dust-events preview --from 12340 --limit 5 --json
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

## `midnight-cast explain [topic]`

Static help (no network). Topics: `dust`, `1010`, `versions`, `transcript`.

```bash
midnight-cast explain dust
midnight-cast explain --json
```

With `--json` and no topic, `explain` returns a catalog of the whole CLI, built from the command definitions so it can't drift from them. It lists every command with its usage, arguments and options, whether it is read-only (only `config init` writes, to the config file), and a link to the schema of its output, plus the global options, the topics, the exit codes and the error kinds. An agent can learn what midnight-cast does from that one call.

---

## JSON output

With `--json`, every command prints one envelope on stdout:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "tip",
  "network": "preprod",
  "data": null,
  "warnings": [],
  "error": {
    "message": "Indexer unreachable",
    "kind": "timeout",
    "hint": "The indexer didn't answer in time. Public endpoints can be slow, so try again, or point at another endpoint with --rpc / --indexer-http."
  },
  "next": [
    {
      "command": "midnight-cast config show --network preprod",
      "reason": "Check the configured endpoints; a wrong or retired URL is the usual cause"
    }
  ]
}
```

`command` is the command path, such as `decode ledger`, and is `null` only for a usage error. `network` is the network the command ran against, when it has one. `data` holds the command's result and `error` is `null` whenever `ok` is true. Some failed checks keep their report in `data`: a failed `ping` still lists every service, and an unhealthy `health` keeps the full report. Warnings that human mode prints on stderr, such as a config that still points at a retired mainnet host, are collected in `warnings`.

`next` lists follow-up commands, always spelled `midnight-cast …`, and appears only in JSON output. Suggested commands keep any `--rpc`, `--indexer-http`, `--indexer-ws` or `--proof-server` override, so they recheck the same endpoints, but never the project ID. The suggestions are: `decode 1010` points at `decode ledger <N>` and `explain 1010`, `tx` points at `decode --raw` when a segment failed and at `dust-event <id>` for each DUST event, a failed `health` points at `ping` or `tip`, and a request that can't reach a configured endpoint points at `config show`. A placeholder in angle brackets, such as `<N>`, has to be filled in before running the command.

`error.kind` says what went wrong. The network kinds are also set on failed rows in `ping` and `health`:

| `kind` | Meaning |
| --- | --- |
| `usage` | The command line was invalid |
| `dns` | The host name doesn't resolve |
| `refused` | Nothing is listening at the URL |
| `timeout` | No answer in time, after retries |
| `tls` | The TLS handshake failed (certificate, proxy or clock) |
| `network` | The connection dropped |
| `http_4xx` | The endpoint rejected the request, e.g. a wrong path (404), a missing token (403) or rate limiting (429) |
| `http_5xx` | The endpoint reported a server error, after retries |
| `rpc_error` | The node rejected the JSON-RPC call |
| `graphql_error` | The indexer rejected the GraphQL query |
| `invalid_response` | The response wasn't the JSON expected |

Other failures, such as an unknown ledger code or a transaction that isn't found, have a `kind` of `null`. `error.hint` suggests what to do, and human mode prints it as a `Hint:` line under the error.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | The command ran and failed: a service is unreachable, a check failed, or a request was rejected |
| `2` | Usage error: an unknown command or option, or a missing argument |

`ping` exits `1` when the RPC or indexer is down. `tip --fail-on-lag`, `health --fail-on-lag`, `health --fail-on-mismatch` and `versions --fail-on-mismatch` exit `1` when their check fails; without those flags they only report.

### Schemas and versioning

JSON Schemas (draft 2020-12) for the envelope and for each command's `data` are in [`schemas/`](../schemas) and ship in the npm package. The `explain --json` catalog links each command to its schema. Data schemas require only the fields that are always present and allow others, so new fields can appear in any release. Removing or renaming a field, or changing its type, is a breaking change: it bumps `schemaVersion` and is called out in the changelog. Check `schemaVersion` before reading the rest.

---

## Networks (built-in)

| Network | Node RPC | Indexer |
|---------|----------|---------|
| `preview` | `https://rpc.preview.midnight.network` | `.../api/v4/graphql` |
| `preprod` | `https://rpc.preprod.midnight.network` | `.../api/v4/graphql` |
| `mainnet` | `https://rpc.midnight-mainnet.blockfrost.io` | `https://midnight-mainnet.blockfrost.io/api/v0` |
| `local` | `http://127.0.0.1:9944` | user-configured |

Built-in proof server URLs: `https://proof-server.<network>.midnight.network` (`GET /` health, `GET /version` for ledger pin). Mainnet has no public proof server; it always runs locally.

### Mainnet and Blockfrost

Midnight retired its hosted mainnet RPC and indexer on 30 September 2026, and Blockfrost serves them now. Every request needs a project ID from a **Midnight Mainnet** project on [blockfrost.io](https://blockfrost.io) (it starts with `nightmainnet`). Pass it with `--project-id`, set it in the network's config section (as `blockfrost_project_id`, or as `project_id` in its URLs), or export `BLOCKFROST_PROJECT_ID`, in that order of precedence. The environment variable applies to every Blockfrost network, so a network's own config wins over it:

```bash
midnight-cast health mainnet --project-id nightmainnet...
export BLOCKFROST_PROJECT_ID=nightmainnet...   # then: midnight-cast health mainnet
```

You can also put it in the config file:

```toml
[networks.mainnet]
blockfrost_project_id = "nightmainnet..."
```

Without a project ID, mainnet commands stop before making any request and say how to get one. midnight-cast sends the ID in Blockfrost's `project_id` header and never prints it: `config show` reports where it came from, and every output is scrubbed of it. A `403` from Blockfrost means the ID is missing, invalid, or for another network. A config file that still points at `rpc.mainnet.midnight.network` or `indexer.mainnet.midnight.network` gets a warning on stderr. Run `midnight-cast config init --network mainnet` to switch it to Blockfrost.

Override any endpoint in config or with flags. See [Midnight network docs](https://docs.midnight.network/relnotes/network).
